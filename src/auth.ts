import { constantTimeEqual, decodeBase64Url, encodeBase64Url, sha256, signText, utf8Decode, utf8Encode } from "./crypto";
import { HttpError } from "./http";

const COOKIE_NAME = "wb_session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const RATE_WINDOW_SECONDS = 15 * 60;
const RATE_MAX_ATTEMPTS = 5;

interface SessionPayload {
  exp: number;
  nonce: string;
}

function isSessionPayload(value: unknown): value is SessionPayload {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.exp === "number" && typeof record.nonce === "string";
}

function getCookie(request: Request, name: string): string | null {
  const raw = request.headers.get("Cookie");
  if (!raw) return null;
  for (const segment of raw.split(";")) {
    const [key, ...rest] = segment.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export async function createSessionCookie(secret: string): Promise<string> {
  const payload: SessionPayload = {
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    nonce: crypto.randomUUID(),
  };
  const encodedPayload = encodeBase64Url(utf8Encode(JSON.stringify(payload)));
  const signature = encodeBase64Url(await signText(encodedPayload, secret));
  return `${COOKIE_NAME}=${encodedPayload}.${signature}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export async function isAuthenticated(request: Request, secret: string): Promise<boolean> {
  const token = getCookie(request, COOKIE_NAME);
  if (!token) return false;
  const [payloadPart, signaturePart, extra] = token.split(".");
  if (!payloadPart || !signaturePart || extra) return false;
  try {
    const expectedSignature = await signText(payloadPart, secret);
    const actualSignature = decodeBase64Url(signaturePart);
    if (!constantTimeEqual(expectedSignature, actualSignature)) return false;
    const parsed = JSON.parse(utf8Decode(decodeBase64Url(payloadPart))) as unknown;
    return isSessionPayload(parsed) && parsed.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export async function requireAuthentication(request: Request, secret: string): Promise<void> {
  if (!(await isAuthenticated(request, secret))) throw new HttpError(401, "请先登录管理后台");
}

export async function verifyPassword(candidate: string, expected: string): Promise<boolean> {
  const [candidateHash, expectedHash] = await Promise.all([sha256(candidate), sha256(expected)]);
  return constantTimeEqual(candidateHash, expectedHash);
}

async function rateLimitKey(request: Request): Promise<string> {
  const address = request.headers.get("CF-Connecting-IP") ?? "unknown";
  return encodeBase64Url((await sha256(`login:${address}`)).slice(0, 18));
}

export async function assertLoginAllowed(request: Request, database: D1Database): Promise<string> {
  const key = await rateLimitKey(request);
  const row = await database
    .prepare("SELECT attempts, window_started_at, blocked_until FROM login_rate_limits WHERE key = ?")
    .bind(key)
    .first<{ attempts: number; window_started_at: number; blocked_until: number | null }>();
  const now = Math.floor(Date.now() / 1000);
  if (row?.blocked_until && row.blocked_until > now) {
    throw new HttpError(429, `尝试次数过多，请在 ${Math.ceil((row.blocked_until - now) / 60)} 分钟后重试`);
  }
  return key;
}

export async function recordLoginFailure(database: D1Database, key: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const row = await database
    .prepare("SELECT attempts, window_started_at FROM login_rate_limits WHERE key = ?")
    .bind(key)
    .first<{ attempts: number; window_started_at: number }>();
  const inWindow = row && now - row.window_started_at < RATE_WINDOW_SECONDS;
  const attempts = inWindow ? row.attempts + 1 : 1;
  const windowStartedAt = inWindow ? row.window_started_at : now;
  const blockedUntil = attempts >= RATE_MAX_ATTEMPTS ? now + RATE_WINDOW_SECONDS : null;
  await database
    .prepare(
      "INSERT INTO login_rate_limits (key, attempts, window_started_at, blocked_until) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET attempts = excluded.attempts, window_started_at = excluded.window_started_at, blocked_until = excluded.blocked_until",
    )
    .bind(key, attempts, windowStartedAt, blockedUntil)
    .run();
}

export async function clearLoginFailures(database: D1Database, key: string): Promise<void> {
  await database.prepare("DELETE FROM login_rate_limits WHERE key = ?").bind(key).run();
}
