import {
  base64ToBytes,
  bytesToBase64,
  constantTimeEqual,
  decodeBase64Url,
  derivePasswordHash,
  encodeBase64Url,
  randomBase64,
  sha256,
  signText,
  utf8Decode,
  utf8Encode,
} from "./crypto";
import { HttpError } from "./http";

const COOKIE_NAME = "wb_session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const RATE_WINDOW_SECONDS = 15 * 60;
const RATE_MAX_ATTEMPTS = 5;
const PASSWORD_ITERATIONS = 100_000;

interface SessionPayload {
  exp: number;
  nonce: string;
  version: number;
}

interface AdminCredentialRow {
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  session_version: number;
}

interface PasswordVerification {
  valid: boolean;
  sessionVersion: number;
}

function isSessionPayload(value: unknown): value is SessionPayload {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.exp === "number" &&
    typeof record.nonce === "string" &&
    typeof record.version === "number" &&
    Number.isInteger(record.version)
  );
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

async function getAdminCredential(database: D1Database): Promise<AdminCredentialRow | null> {
  return database
    .prepare(
      "SELECT password_hash, password_salt, password_iterations, session_version FROM admin_credentials WHERE id = 1",
    )
    .first<AdminCredentialRow>();
}

async function verifyDerivedPassword(candidate: string, credential: AdminCredentialRow): Promise<boolean> {
  if (credential.password_iterations < 10_000 || credential.password_iterations > 500_000) return false;
  try {
    const actual = await derivePasswordHash(candidate, credential.password_salt, credential.password_iterations);
    const expected = base64ToBytes(credential.password_hash);
    return constantTimeEqual(actual, expected);
  } catch {
    return false;
  }
}

async function writeAdminCredential(database: D1Database, password: string, sessionVersion: number): Promise<void> {
  const salt = randomBase64(16);
  const hash = bytesToBase64(await derivePasswordHash(password, salt, PASSWORD_ITERATIONS));
  await database
    .prepare(
      "INSERT INTO admin_credentials (id, password_hash, password_salt, password_iterations, session_version, updated_at) " +
        "VALUES (1, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash, " +
        "password_salt = excluded.password_salt, password_iterations = excluded.password_iterations, " +
        "session_version = excluded.session_version, updated_at = excluded.updated_at",
    )
    .bind(hash, salt, PASSWORD_ITERATIONS, sessionVersion, Date.now())
    .run();
}

async function initializeAdminCredential(database: D1Database, password: string): Promise<void> {
  const salt = randomBase64(16);
  const hash = bytesToBase64(await derivePasswordHash(password, salt, PASSWORD_ITERATIONS));
  await database
    .prepare(
      "INSERT OR IGNORE INTO admin_credentials " +
        "(id, password_hash, password_salt, password_iterations, session_version, updated_at) VALUES (1, ?, ?, ?, 1, ?)",
    )
    .bind(hash, salt, PASSWORD_ITERATIONS, Date.now())
    .run();
}

export async function authenticateAdminPassword(
  database: D1Database,
  candidate: string,
  bootstrapPassword: string,
): Promise<PasswordVerification> {
  let credential = await getAdminCredential(database);
  if (!credential) {
    if (!(await verifyPassword(candidate, bootstrapPassword))) return { valid: false, sessionVersion: 1 };
    await initializeAdminCredential(database, candidate);
    credential = await getAdminCredential(database);
  }
  if (!credential) throw new Error("admin_credential_initialization_failed");
  return {
    valid: await verifyDerivedPassword(candidate, credential),
    sessionVersion: credential.session_version,
  };
}

export async function changeAdminPassword(
  database: D1Database,
  currentPassword: string,
  newPassword: string,
  bootstrapPassword: string,
): Promise<{ changed: boolean; sessionVersion: number }> {
  const current = await authenticateAdminPassword(database, currentPassword, bootstrapPassword);
  if (!current.valid) return { changed: false, sessionVersion: current.sessionVersion };
  const nextVersion = current.sessionVersion + 1;
  await writeAdminCredential(database, newPassword, nextVersion);
  return { changed: true, sessionVersion: nextVersion };
}

async function getCurrentSessionVersion(database: D1Database): Promise<number> {
  const credential = await getAdminCredential(database);
  return credential?.session_version ?? 1;
}

export async function createSessionCookie(secret: string, sessionVersion: number): Promise<string> {
  const payload: SessionPayload = {
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    nonce: crypto.randomUUID(),
    version: sessionVersion,
  };
  const encodedPayload = encodeBase64Url(utf8Encode(JSON.stringify(payload)));
  const signature = encodeBase64Url(await signText(encodedPayload, secret));
  return `${COOKIE_NAME}=${encodedPayload}.${signature}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export async function isAuthenticated(request: Request, secret: string, database: D1Database): Promise<boolean> {
  const token = getCookie(request, COOKIE_NAME);
  if (!token) return false;
  const [payloadPart, signaturePart, extra] = token.split(".");
  if (!payloadPart || !signaturePart || extra) return false;
  try {
    const expectedSignature = await signText(payloadPart, secret);
    const actualSignature = decodeBase64Url(signaturePart);
    if (!constantTimeEqual(expectedSignature, actualSignature)) return false;
    const parsed = JSON.parse(utf8Decode(decodeBase64Url(payloadPart))) as unknown;
    if (!isSessionPayload(parsed) || parsed.exp <= Math.floor(Date.now() / 1000)) return false;
    return parsed.version === (await getCurrentSessionVersion(database));
  } catch {
    return false;
  }
}

export async function requireAuthentication(request: Request, secret: string, database: D1Database): Promise<void> {
  if (!(await isAuthenticated(request, secret, database))) throw new HttpError(401, "请先登录管理后台");
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
