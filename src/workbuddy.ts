import type { AccountProfile, AccountRow, CredentialPayload, OAuthPayload, WorkBuddyResponse } from "./types";

const API_BASE = "https://www.codebuddy.cn";
const REQUEST_TIMEOUT_MS = 15_000;

export interface FetchResult {
  httpStatus: number;
  body: WorkBuddyResponse;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function messageOf(body: WorkBuddyResponse): string {
  return body.message ?? body.msg ?? "WorkBuddy 接口返回失败";
}

export function isWorkBuddySuccess(body: WorkBuddyResponse): boolean {
  return body.code === 0 || body.code === 200 || body.code === "0" || body.code === "200" || body.success === true;
}

export function isUnauthorized(result: FetchResult): boolean {
  if (result.httpStatus === 401 || result.httpStatus === 403) return true;
  const message = messageOf(result.body).toLowerCase();
  return ["unauthorized", "token expired", "token失效", "登录过期", "请重新登录", "未登录"].some((text) =>
    message.includes(text),
  );
}

export function normalizeTimestamp(value: unknown, relativeSeconds?: unknown): number | undefined {
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) value = numeric;
    else {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? undefined : parsed;
    }
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  const seconds = typeof relativeSeconds === "string" ? Number(relativeSeconds) : relativeSeconds;
  if (typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0) return Date.now() + seconds * 1000;
  return undefined;
}

async function request(url: string, init: RequestInit): Promise<FetchResult> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  let body: WorkBuddyResponse;
  try {
    body = await response.json();
  } catch {
    body = { code: response.status, message: `接口返回了无法识别的内容（HTTP ${response.status}）` };
  }
  return { httpStatus: response.status, body };
}

function baseHeaders(): Headers {
  return new Headers({
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "WorkBuddy-Auto-Checkin/1.0",
  });
}

function authHeaders(credentials: CredentialPayload, account?: AccountRow): Headers {
  const headers = baseHeaders();
  headers.set("Authorization", `Bearer ${credentials.accessToken}`);
  if (credentials.domain) headers.set("X-Domain", credentials.domain);
  if (account?.uid) headers.set("X-User-Id", account.uid);
  if (account?.enterprise_id) {
    headers.set("X-Enterprise-Id", account.enterprise_id);
    headers.set("X-Tenant-Id", account.enterprise_id);
  }
  return headers;
}

function safeAuthUrl(candidate: string | undefined, state: string): string {
  if (candidate) {
    try {
      const url = new URL(candidate);
      if (url.protocol === "https:" && (url.hostname === "codebuddy.cn" || url.hostname.endsWith(".codebuddy.cn"))) {
        return url.toString();
      }
    } catch {
      // Fall through to the official URL.
    }
  }
  return `${API_BASE}/login?state=${encodeURIComponent(state)}`;
}

export async function startOAuth(): Promise<OAuthPayload> {
  const result = await request(`${API_BASE}/v2/plugin/auth/state?platform=workbuddy`, {
    method: "POST",
    headers: baseHeaders(),
    body: "{}",
  });
  const root = result.body as WorkBuddyResponse & Record<string, unknown>;
  const data = asRecord(result.body.data);
  const state = stringValue(data?.state) ?? stringValue(root.state);
  if (!isWorkBuddySuccess(result.body) || !state) throw new Error(messageOf(result.body));
  const authUrl =
    stringValue(data?.authUrl) ??
    stringValue(data?.auth_url) ??
    stringValue(data?.url) ??
    stringValue(root.authUrl) ??
    stringValue(root.auth_url) ??
    stringValue(root.url);
  return { state, authUrl: safeAuthUrl(authUrl, state) };
}

export async function pollOAuth(state: string): Promise<{ pending: true } | { pending: false; credentials: CredentialPayload }> {
  const result = await request(`${API_BASE}/v2/plugin/auth/token?state=${encodeURIComponent(state)}`, {
    method: "GET",
    headers: baseHeaders(),
  });
  const data = asRecord(result.body.data);
  if (!data) return { pending: true };
  const accessToken = stringValue(data?.accessToken) ?? stringValue(data?.access_token);
  if (!isWorkBuddySuccess(result.body) || !accessToken) return { pending: true };
  const refreshToken = stringValue(data.refreshToken) ?? stringValue(data.refresh_token);
  const expiresAt = normalizeTimestamp(data.expiresAt, data.expiresIn);
  const refreshExpiresAt = normalizeTimestamp(data.refreshExpiresAt, data.refreshExpiresIn);
  return {
    pending: false,
    credentials: {
      accessToken,
      ...(refreshToken ? { refreshToken } : {}),
      domain: stringValue(data.domain) ?? "",
      ...(expiresAt ? { expiresAt } : {}),
      ...(refreshExpiresAt ? { refreshExpiresAt } : {}),
    },
  };
}

export async function getAccountProfile(state: string, credentials: CredentialPayload): Promise<AccountProfile> {
  const result = await request(`${API_BASE}/v2/plugin/login/account?state=${encodeURIComponent(state)}`, {
    method: "GET",
    headers: authHeaders(credentials),
  });
  const data = asRecord(result.body.data);
  const uid = stringValue(data?.uid) ?? stringValue(data?.userId) ?? stringValue(data?.user_id);
  if (!isWorkBuddySuccess(result.body) || !data || !uid) throw new Error(messageOf(result.body));
  return {
    uid,
    nickname: stringValue(data.nickname) ?? stringValue(data.name) ?? null,
    email: stringValue(data.email) ?? null,
    enterpriseId: stringValue(data.enterpriseId) ?? stringValue(data.enterprise_id) ?? null,
    enterpriseName: stringValue(data.enterpriseName) ?? stringValue(data.enterprise_name) ?? null,
  };
}

export async function refreshCredentials(credentials: CredentialPayload): Promise<CredentialPayload> {
  if (!credentials.refreshToken) throw new Error("缺少刷新凭据，请重新扫码登录");
  const headers = baseHeaders();
  headers.set("X-Refresh-Token", credentials.refreshToken);
  headers.set("X-Auth-Refresh-Source", "plugin");
  if (credentials.domain) headers.set("X-Domain", credentials.domain);
  const result = await request(`${API_BASE}/v2/plugin/auth/token/refresh`, { method: "POST", headers, body: "{}" });
  const data = asRecord(result.body.data);
  const accessToken = stringValue(data?.accessToken) ?? stringValue(data?.access_token);
  if (!isWorkBuddySuccess(result.body) || !data || !accessToken) throw new Error(messageOf(result.body));
  const expiresAt = normalizeTimestamp(data.expiresAt, data.expiresIn);
  const refreshExpiresAt = normalizeTimestamp(data.refreshExpiresAt, data.refreshExpiresIn) ?? credentials.refreshExpiresAt;
  return {
    accessToken,
    refreshToken: stringValue(data.refreshToken) ?? stringValue(data.refresh_token) ?? credentials.refreshToken,
    domain: stringValue(data.domain) ?? credentials.domain,
    ...(expiresAt ? { expiresAt } : {}),
    ...(refreshExpiresAt ? { refreshExpiresAt } : {}),
  };
}

export async function fetchCheckinStatus(credentials: CredentialPayload, account: AccountRow): Promise<FetchResult> {
  const primary = await request(`${API_BASE}/v2/billing/meter/checkin-activity-status`, {
    method: "POST",
    headers: authHeaders(credentials, account),
    body: "{}",
  });
  if (isWorkBuddySuccess(primary.body) || isUnauthorized(primary)) return primary;
  return request(`${API_BASE}/v2/billing/meter/checkin-status`, {
    method: "POST",
    headers: authHeaders(credentials, account),
    body: "{}",
  });
}

export function hasCheckedInToday(result: FetchResult): boolean {
  const data = asRecord(result.body.data);
  return data?.today_checked_in === true || data?.todayCheckedIn === true;
}

export async function submitDailyCheckin(credentials: CredentialPayload, account: AccountRow): Promise<FetchResult> {
  return request(`${API_BASE}/v2/billing/meter/daily-checkin`, {
    method: "POST",
    headers: authHeaders(credentials, account),
    body: "{}",
  });
}

export function workBuddyMessage(result: FetchResult): string {
  return messageOf(result.body).slice(0, 300);
}
