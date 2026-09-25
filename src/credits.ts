import {
  acquireCreditLock,
  getAccount,
  getCredentials,
  listAccounts,
  markNeedsRelogin,
  recordCredits,
  recordCreditsError,
  releaseCheckinLock,
  saveCredentials,
  toPublicAccount,
} from "./repository";
import type {
  AccountRow,
  CreditRefreshResult,
  CreditSummary,
  CredentialPayload,
  WorkBuddyResponse,
} from "./types";
import {
  type FetchResult,
  isUnauthorized,
  isWorkBuddySuccess,
  postCreditResource,
  refreshCredentials,
  workBuddyMessage,
} from "./workbuddy";
import { billingPaths } from "./variant";

const SUMMARY_PATH = "/billing/meter/get-user-resource-summary";
const PAID_PATH = "/billing/meter/get-user-resource-paid-packages";
const FREE_PATH = "/billing/meter/get-user-resource-free-packages";
const LEGACY_PATH = "/v2/billing/meter/get-user-resource";
const DAY_MS = 24 * 60 * 60 * 1000;

const PAID_PACKAGE_CODES = [
  "TCACA_code_002_AkiJS3ZHF5",
  "TCACA_code_023_4xbGhMrE6q",
  "TCACA_code_026_BaESVICNoi",
  "TCACA_code_027_0FCGVA6vSa",
  "TCACA_code_009_0XmEQc2xOf",
  "TCACA_code_038_OhvqZtiPKr",
  "TCACA_code_003_FAnt7lcmRT",
  "TCACA_code_036_lupO5WgNdG",
];

const FREE_PACKAGE_CODES = [
  "TCACA_code_008_cfWoLwvjU4",
  "TCACA_code_007_nzdH5h4Nl0",
  "TCACA_code_028_NtpWi0jzXs",
  "TCACA_code_029_6wCGEWquYy",
  "TCACA_code_030_BjSt89qTvr",
  "TCACA_code_001_PqouKr6QWV",
  "TCACA_code_006_DbXS0lrypC",
  "TCACA_code_035_ArVxJcGDsm",
  "TCACA_code_037_WxOD3MpI2o",
  "TCACA_code_039_KRcQj7wUat",
  "TCACA_code_040_mi9rCYg46x",
];

interface NormalizedResource {
  packageCode: string | null;
  total: number;
  remaining: number;
  expireAt: number | null;
}

interface NewResponses {
  summary: FetchResult;
  paid: FetchResult;
  free: FetchResult;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function firstValue(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function firstNumber(record: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const parsed = numberValue(record[key]);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function timestampValue(value: unknown): number | undefined {
  const numeric = numberValue(value);
  if (numeric !== undefined && numeric > 0) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const text = value.trim();
  const naive = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?)?$/u.exec(text);
  if (naive) {
    const [, year = "0", month = "1", day = "1", hour = "23", minute = "59", second = "59", millis = "0"] = naive;
    return Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour) - 8,
      Number(minute),
      Number(second),
      Number(millis.padEnd(3, "0")),
    );
  }
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function resolveExpireAt(raw: Record<string, unknown>, now: number): number | null {
  const deduction = timestampValue(
    firstValue(raw, ["DeductionEndTime", "deductionEndTime", "ExpiredTime", "expiredTime", "SlicePeriodEndTime", "slicePeriodEndTime", "PackageEndTime", "EndTime", "ExpireTime", "ExpirationTime", "ValidEndTime", "EndAt", "ExpireAt"]),
  );
  const cycle = timestampValue(firstValue(raw, ["CycleEndTime", "cycleEndTime"]));
  let expireAt = deduction;
  if (deduction !== undefined && cycle !== undefined && deduction - cycle > 365 * DAY_MS) expireAt = cycle;
  if (expireAt === undefined) expireAt = cycle;
  if (expireAt === undefined || expireAt < now - 365 * DAY_MS || expireAt > Date.UTC(2100, 0, 1)) return null;
  return expireAt;
}

function normalizeResource(value: unknown, now: number, detail?: Record<string, unknown>): NormalizedResource | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const totalKeys = [
    "SlicePeriodCapacitySizePrecise",
    "SlicePeriodCapacitySize",
    "CycleCapacitySizePrecise",
    "CycleCapacitySize",
    "CycleTotalCapacity",
    "CapacitySizePrecise",
    "CapacitySize",
  ];
  const remainingKeys = [
    "SlicePeriodCapacityRemainPrecise",
    "SlicePeriodCapacityRemain",
    "CycleCapacityRemainPrecise",
    "CycleCapacityRemain",
    "CycleRemainCapacity",
    "CapacityRemainPrecise",
    "CapacityRemain",
  ];
  const usedKeys = [
    "CycleCapacityUsedPrecise",
    "CycleCapacityUsed",
    "CycleUsedCapacity",
    "CapacityUsedPrecise",
    "CapacityUsed",
    "SlicePeriodCapacityUsedPrecise",
    "SlicePeriodCapacityUsed",
  ];
  const amounts = detail ?? raw;
  const rawTotal = firstNumber(amounts, totalKeys);
  const rawRemaining = firstNumber(amounts, remainingKeys);
  const rawUsed = firstNumber(amounts, usedKeys);
  const total = Math.max(0, rawTotal ?? (rawRemaining !== undefined && rawUsed !== undefined ? rawRemaining + rawUsed : rawRemaining ?? rawUsed ?? 0));
  const remaining = Math.max(0, rawRemaining ?? total - (rawUsed ?? 0));
  const packageCode = firstValue(raw, ["PackageCode", "packageCode"]);
  return {
    packageCode: typeof packageCode === "string" && packageCode ? packageCode : null,
    total,
    remaining,
    expireAt: detail ? resolveExpireAt(detail, now) ?? resolveExpireAt(raw, now) : resolveExpireAt(raw, now),
  };
}

function normalizeResources(value: unknown, now: number): NormalizedResource[] {
  const raw = asRecord(value);
  if (!raw) return [];
  const slices = firstValue(raw, ["SlicePeriodUsageDetails", "slicePeriodUsageDetails"]);
  if (Array.isArray(slices) && slices.length) {
    const details = slices
      .map(asRecord)
      .filter((item): item is Record<string, unknown> => item !== null)
      .filter((item) => Object.keys(item).some((key) => /(?:Capacity|Remain|Used|Quota|Balance)/iu.test(key)))
      .map((item) => normalizeResource(raw, now, item))
      .filter((item): item is NormalizedResource => item !== null);
    if (details.length) return details;
  }
  const resource = normalizeResource(raw, now);
  return resource ? [resource] : [];
}

function valueAtPath(value: unknown, path: readonly string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    const record = asRecord(current);
    if (!record) return undefined;
    current = record[key];
  }
  return current;
}

function resourceArray(body: WorkBuddyResponse, key: "Accounts" | "Packages"): unknown[] | null {
  const lowerKey = key.toLowerCase();
  const paths = [
    ["data", key],
    ["data", "data", key],
    ["data", "Response", "Data", key],
    ["data", "data", "Response", "Data", key],
    ["data", lowerKey],
    ["data", "data", lowerKey],
  ];
  for (const path of paths) {
    const candidate = valueAtPath(body, path);
    if (Array.isArray(candidate)) return candidate.map((item: unknown): unknown => item);
  }
  return null;
}

function isCreditSuccess(body: WorkBuddyResponse): boolean {
  if (isWorkBuddySuccess(body)) return true;
  const record = body as Record<string, unknown>;
  return body.code === undefined && record.data !== undefined && body.success !== false;
}

function summarize(resources: NormalizedResource[]): CreditSummary {
  const totalCapacity = resources.reduce((sum, resource) => sum + resource.total, 0);
  const totalRemaining = resources.reduce((sum, resource) => sum + resource.remaining, 0);
  const buckets = new Map<number | null, number>();
  for (const resource of resources) {
    if (resource.remaining <= 0) continue;
    buckets.set(resource.expireAt, (buckets.get(resource.expireAt) ?? 0) + resource.remaining);
  }
  const expiryBuckets = [...buckets].map(([expiresAt, remaining]) => ({ remaining, expiresAt }))
    .sort((left, right) => (left.expiresAt ?? Infinity) - (right.expiresAt ?? Infinity));
  return {
    totalCapacity,
    totalRemaining,
    soonestExpireAt: expiryBuckets.find((bucket) => bucket.expiresAt !== null)?.expiresAt ?? null,
    expiryBuckets,
  };
}

export function normalizeNewCreditSummary(responses: NewResponses, now = Date.now()): CreditSummary | null {
  const summaryItems = isCreditSuccess(responses.summary.body) ? resourceArray(responses.summary.body, "Packages") : null;
  const paidItems = isCreditSuccess(responses.paid.body) ? resourceArray(responses.paid.body, "Accounts") : null;
  const freeItems = isCreditSuccess(responses.free.body) ? resourceArray(responses.free.body, "Accounts") : null;
  if (summaryItems === null && paidItems === null && freeItems === null) return null;

  const details = [...(paidItems ?? []), ...(freeItems ?? [])].flatMap((item) => normalizeResources(item, now));
  const detailCodes = new Set(details.map((item) => item.packageCode).filter((code): code is string => code !== null));
  const summary = (summaryItems ?? [])
    .flatMap((item) => normalizeResources(item, now))
    .filter((item) => item.packageCode === null || !detailCodes.has(item.packageCode));
  return summarize([...details, ...summary]);
}

export function normalizeLegacyCreditSummary(result: FetchResult, now = Date.now()): CreditSummary | null {
  if (!isCreditSuccess(result.body)) return null;
  const items = resourceArray(result.body, "Accounts");
  if (items === null) return null;
  return summarize(items.flatMap((item) => normalizeResources(item, now)));
}

function beijingRange(now: number): { start: string; end: string } {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
  return { start: `${date} 00:00:00`, end: `${date} 23:59:59` };
}

function legacyRange(now: number): { start: string; end: string } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  return { start: formatter.format(new Date(now)).replace(",", ""), end: formatter.format(new Date(now + 101 * 365 * DAY_MS)).replace(",", "") };
}

async function fetchNewResponses(credentials: CredentialPayload, account: AccountRow, now: number): Promise<NewResponses> {
  const range = beijingRange(now);
  const [summary, paid, free] = await Promise.all([
    safePostCreditResource(credentials, account, SUMMARY_PATH, {}),
    safePostCreditResource(credentials, account, PAID_PATH, {
      PageNumber: 1,
      PageSize: 200,
      Status: [0, 3],
      PackageCodes: PAID_PACKAGE_CODES,
      NeedRenewInfo: true,
    }),
    safePostCreditResource(credentials, account, FREE_PATH, {
      PageNumber: 1,
      PageSize: 200,
      Status: [0, 3],
      SlicePeriodStartTime: range.start,
      SlicePeriodEndTime: range.end,
      PackageCodes: FREE_PACKAGE_CODES,
    }),
  ]);
  return { summary, paid, free };
}

async function safePostCreditResource(
  credentials: CredentialPayload,
  account: AccountRow,
  path: string,
  body: Record<string, unknown>,
): Promise<FetchResult> {
  try {
    return await postCreditResource(credentials, account, path, body);
  } catch {
    try {
      return await postCreditResource(credentials, account, path, body);
    } catch {
      return { httpStatus: 0, body: { code: -1, message: "积分接口连接失败，请稍后重试" } };
    }
  }
}

async function safePostCreditResourceWithFallback(
  credentials: CredentialPayload,
  account: AccountRow,
  path: string,
  body: Record<string, unknown>,
): Promise<FetchResult> {
  let last: FetchResult = { httpStatus: 0, body: { code: -1, message: "积分接口连接失败，请稍后重试" } };
  for (const candidate of billingPaths(account.variant, path)) {
    last = await safePostCreditResource(credentials, account, candidate, body);
    if (last.httpStatus !== 404) return last;
  }
  return last;
}

async function retrySummary(credentials: CredentialPayload, account: AccountRow): Promise<FetchResult> {
  return safePostCreditResource(credentials, account, SUMMARY_PATH, {});
}

async function retryPaid(credentials: CredentialPayload, account: AccountRow): Promise<FetchResult> {
  return safePostCreditResource(credentials, account, PAID_PATH, {
    PageNumber: 1,
    PageSize: 200,
    Status: [0, 3],
    PackageCodes: PAID_PACKAGE_CODES,
    NeedRenewInfo: true,
  });
}

async function retryFree(
  credentials: CredentialPayload,
  account: AccountRow,
  now: number,
): Promise<FetchResult> {
  const range = beijingRange(now);
  return safePostCreditResource(credentials, account, FREE_PATH, {
    PageNumber: 1,
    PageSize: 200,
    Status: [0, 3],
    SlicePeriodStartTime: range.start,
    SlicePeriodEndTime: range.end,
    PackageCodes: FREE_PACKAGE_CODES,
  });
}

async function retryUnauthorizedResponses(
  responses: NewResponses,
  credentials: CredentialPayload,
  account: AccountRow,
  now: number,
): Promise<NewResponses> {
  if (![responses.summary, responses.paid, responses.free].some(isUnauthorized)) return responses;
  const [summary, paid, free] = await Promise.all([
    isUnauthorized(responses.summary) ? retrySummary(credentials, account) : Promise.resolve(responses.summary),
    isUnauthorized(responses.paid) ? retryPaid(credentials, account) : Promise.resolve(responses.paid),
    isUnauthorized(responses.free) ? retryFree(credentials, account, now) : Promise.resolve(responses.free),
  ]);
  return {
    summary,
    paid,
    free,
  };
}

async function fetchLegacy(credentials: CredentialPayload, account: AccountRow, now: number): Promise<FetchResult> {
  const range = legacyRange(now);
  return safePostCreditResourceWithFallback(credentials, account, LEGACY_PATH, {
    PageNumber: 1,
    PageSize: 100,
    ProductCode: "p_tcaca",
    Status: [0, 3],
    PackageEndTimeRangeBegin: range.start,
    PackageEndTimeRangeEnd: range.end,
  });
}

async function ensureFreshCredentials(
  env: Env,
  account: AccountRow,
  credentials: CredentialPayload,
): Promise<CredentialPayload> {
  if (!credentials.expiresAt || credentials.expiresAt > Date.now() + 5 * 60 * 1000) return credentials;
  if (credentials.refreshExpiresAt && credentials.refreshExpiresAt <= Date.now()) {
    throw new Error("登录状态已过期，请重新登录");
  }
  const refreshed = await refreshCredentials(credentials, account);
  await saveCredentials(env.DB, account.id, refreshed, env.TOKEN_ENCRYPTION_KEY);
  return refreshed;
}

async function performCreditRefresh(env: Env, account: AccountRow): Promise<CreditSummary> {
  const now = Date.now();
  let credentials = await getCredentials(account, env.TOKEN_ENCRYPTION_KEY);
  credentials = await ensureFreshCredentials(env, account, credentials);

  if (account.variant === "ai") {
    let legacy = await fetchLegacy(credentials, account, now);
    if (isUnauthorized(legacy)) {
      credentials = await refreshCredentials(credentials, account);
      await saveCredentials(env.DB, account.id, credentials, env.TOKEN_ENCRYPTION_KEY);
      legacy = await fetchLegacy(credentials, account, now);
    }
    if (isUnauthorized(legacy)) throw new Error("登录状态已失效，请重新登录");
    const legacySummary = normalizeLegacyCreditSummary(legacy, now);
    if (legacySummary) return legacySummary;
    throw new Error(workBuddyMessage(legacy));
  }

  let refreshedAfterUnauthorized = false;
  let responses = await fetchNewResponses(credentials, account, now);
  if ([responses.summary, responses.paid, responses.free].some(isUnauthorized)) {
    credentials = await refreshCredentials(credentials, account);
    await saveCredentials(env.DB, account.id, credentials, env.TOKEN_ENCRYPTION_KEY);
    responses = await retryUnauthorizedResponses(responses, credentials, account, now);
    refreshedAfterUnauthorized = true;
  }
  const normalized = normalizeNewCreditSummary(responses, now);
  if (normalized) return normalized;

  let legacy = await fetchLegacy(credentials, account, now);
  if (isUnauthorized(legacy) && !refreshedAfterUnauthorized) {
    credentials = await refreshCredentials(credentials, account);
    await saveCredentials(env.DB, account.id, credentials, env.TOKEN_ENCRYPTION_KEY);
    legacy = await fetchLegacy(credentials, account, now);
  }
  if (isUnauthorized(legacy)) throw new Error("登录状态已失效，请重新登录");
  const legacySummary = normalizeLegacyCreditSummary(legacy, now);
  if (legacySummary) return legacySummary;
  throw new Error(workBuddyMessage(legacy));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message.slice(0, 300);
  return "积分读取失败";
}

export async function refreshAccountCredits(env: Env, accountId: string): Promise<CreditRefreshResult> {
  const account = await getAccount(env.DB, accountId);
  if (!(await acquireCreditLock(env.DB, account.id))) {
    return { accountId: account.id, status: "busy", message: "该账号正在处理其他操作，请稍后重试" };
  }
  try {
    const summary = await performCreditRefresh(env, account);
    await recordCredits(env.DB, account.id, summary);
    const updated = await getAccount(env.DB, account.id);
    console.log(JSON.stringify({ message: "credits_refreshed", accountId: account.id }));
    return {
      accountId: account.id,
      status: "success",
      message: "积分已更新",
      credits: toPublicAccount(updated).credits,
    };
  } catch (error) {
    const message = errorMessage(error);
    await recordCreditsError(env.DB, account.id, message);
    if (/登录|token|凭据|credential|unauthorized|decrypt/iu.test(message)) {
      await markNeedsRelogin(env.DB, account.id, "登录状态失效，请重新登录");
    }
    console.warn(JSON.stringify({ message: "credits_refresh_failed", accountId: account.id, error: message }));
    return { accountId: account.id, status: "error", message };
  } finally {
    await releaseCheckinLock(env.DB, account.id);
  }
}

export async function refreshAllCredits(env: Env): Promise<CreditRefreshResult[]> {
  const accounts = await listAccounts(env.DB);
  const results: CreditRefreshResult[] = [];
  for (const account of accounts) results.push(await refreshAccountCredits(env, account.id));
  return results;
}
