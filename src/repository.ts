import { decryptJson, encryptJson } from "./crypto";
import { HttpError } from "./http";
import type {
  AccountProfile,
  AccountRow,
  CheckinLogRow,
  CredentialPayload,
  OAuthPayload,
  OAuthSessionRow,
  PublicAccount,
} from "./types";

function isCredentialPayload(value: unknown): value is CredentialPayload {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.accessToken === "string" &&
    typeof record.domain === "string" &&
    (record.refreshToken === undefined || typeof record.refreshToken === "string") &&
    (record.expiresAt === undefined || typeof record.expiresAt === "number") &&
    (record.refreshExpiresAt === undefined || typeof record.refreshExpiresAt === "number")
  );
}

function isOAuthPayload(value: unknown): value is OAuthPayload {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.state === "string" && typeof record.authUrl === "string";
}

export function toPublicAccount(row: AccountRow): PublicAccount {
  return {
    id: row.id,
    uid: row.uid,
    nickname: row.nickname,
    email: row.email,
    enterpriseName: row.enterprise_name,
    enabled: row.enabled === 1,
    needsRelogin: row.needs_relogin === 1,
    reloginReason: row.relogin_reason,
    lastCheckinStatus: row.last_checkin_status,
    lastCheckinMessage: row.last_checkin_message,
    lastCheckinAt: row.last_checkin_at,
    createdAt: row.created_at,
  };
}

export async function listAccounts(database: D1Database): Promise<AccountRow[]> {
  const result = await database.prepare("SELECT * FROM accounts ORDER BY created_at ASC").all<AccountRow>();
  return result.results;
}

export async function getAccount(database: D1Database, id: string): Promise<AccountRow> {
  const row = await database.prepare("SELECT * FROM accounts WHERE id = ?").bind(id).first<AccountRow>();
  if (!row) throw new HttpError(404, "账号不存在");
  return row;
}

export async function getCredentials(row: AccountRow, secret: string): Promise<CredentialPayload> {
  const value = await decryptJson(row.credential_ciphertext, row.credential_iv, secret);
  if (!isCredentialPayload(value)) throw new Error("credential_payload_invalid");
  return value;
}

export async function saveCredentials(
  database: D1Database,
  accountId: string,
  credentials: CredentialPayload,
  secret: string,
): Promise<void> {
  const encrypted = await encryptJson(credentials, secret);
  await database
    .prepare(
      "UPDATE accounts SET credential_ciphertext = ?, credential_iv = ?, expires_at = ?, refresh_expires_at = ?, " +
        "needs_relogin = 0, relogin_reason = NULL, updated_at = ? WHERE id = ?",
    )
    .bind(
      encrypted.ciphertext,
      encrypted.iv,
      credentials.expiresAt ?? null,
      credentials.refreshExpiresAt ?? null,
      Date.now(),
      accountId,
    )
    .run();
}

export async function upsertAccount(
  database: D1Database,
  profile: AccountProfile,
  credentials: CredentialPayload,
  secret: string,
): Promise<string> {
  const existing = await database
    .prepare("SELECT id FROM accounts WHERE uid = ? AND domain = ?")
    .bind(profile.uid, credentials.domain)
    .first<{ id: string }>();
  const id = existing?.id ?? crypto.randomUUID();
  const now = Date.now();
  const encrypted = await encryptJson(credentials, secret);
  await database
    .prepare(
      "INSERT INTO accounts (id, uid, nickname, email, enterprise_id, enterprise_name, domain, credential_ciphertext, credential_iv, " +
        "expires_at, refresh_expires_at, enabled, needs_relogin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?) " +
        "ON CONFLICT(uid, domain) DO UPDATE SET nickname = excluded.nickname, email = excluded.email, enterprise_id = excluded.enterprise_id, " +
        "enterprise_name = excluded.enterprise_name, credential_ciphertext = excluded.credential_ciphertext, credential_iv = excluded.credential_iv, " +
        "expires_at = excluded.expires_at, refresh_expires_at = excluded.refresh_expires_at, needs_relogin = 0, relogin_reason = NULL, updated_at = excluded.updated_at",
    )
    .bind(
      id,
      profile.uid,
      profile.nickname,
      profile.email,
      profile.enterpriseId,
      profile.enterpriseName,
      credentials.domain,
      encrypted.ciphertext,
      encrypted.iv,
      credentials.expiresAt ?? null,
      credentials.refreshExpiresAt ?? null,
      now,
      now,
    )
    .run();
  return id;
}

export async function createOAuthSession(
  database: D1Database,
  payload: OAuthPayload,
  secret: string,
): Promise<{ id: string; expiresAt: number }> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = now + 10 * 60 * 1000;
  const encrypted = await encryptJson(payload, secret);
  await database
    .prepare(
      "INSERT INTO oauth_sessions (id, payload_ciphertext, payload_iv, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(id, encrypted.ciphertext, encrypted.iv, expiresAt, now)
    .run();
  return { id, expiresAt };
}

export async function getOAuthSession(database: D1Database, id: string, secret: string): Promise<OAuthPayload> {
  const row = await database.prepare("SELECT * FROM oauth_sessions WHERE id = ?").bind(id).first<OAuthSessionRow>();
  if (!row || row.expires_at <= Date.now()) throw new HttpError(410, "二维码已过期，请重新生成");
  const payload = await decryptJson(row.payload_ciphertext, row.payload_iv, secret);
  if (!isOAuthPayload(payload)) throw new Error("oauth_payload_invalid");
  return payload;
}

export async function deleteOAuthSession(database: D1Database, id: string): Promise<void> {
  await database.prepare("DELETE FROM oauth_sessions WHERE id = ?").bind(id).run();
}

export async function setAccountEnabled(database: D1Database, id: string, enabled: boolean): Promise<void> {
  const result = await database
    .prepare("UPDATE accounts SET enabled = ?, updated_at = ? WHERE id = ?")
    .bind(enabled ? 1 : 0, Date.now(), id)
    .run();
  if (result.meta.changes === 0) throw new HttpError(404, "账号不存在");
}

export async function deleteAccount(database: D1Database, id: string): Promise<void> {
  const result = await database.prepare("DELETE FROM accounts WHERE id = ?").bind(id).run();
  if (result.meta.changes === 0) throw new HttpError(404, "账号不存在");
}

export async function acquireCheckinLock(database: D1Database, id: string): Promise<boolean> {
  const now = Date.now();
  const result = await database
    .prepare(
      "UPDATE accounts SET checkin_lock_until = ? WHERE id = ? AND enabled = 1 AND (checkin_lock_until IS NULL OR checkin_lock_until < ?)",
    )
    .bind(now + 2 * 60 * 1000, id, now)
    .run();
  return result.meta.changes === 1;
}

export async function releaseCheckinLock(database: D1Database, id: string): Promise<void> {
  await database.prepare("UPDATE accounts SET checkin_lock_until = NULL WHERE id = ?").bind(id).run();
}

export async function recordCheckin(
  database: D1Database,
  id: string,
  localDate: string,
  status: string,
  message: string,
): Promise<void> {
  const now = Date.now();
  await database.batch([
    database
      .prepare(
        "UPDATE accounts SET last_checkin_status = ?, last_checkin_message = ?, last_checkin_at = ?, updated_at = ? WHERE id = ?",
      )
      .bind(status, message, now, now, id),
    database
      .prepare("INSERT INTO checkin_logs (account_id, local_date, status, message, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(id, localDate, status, message, now),
  ]);
}

export async function markNeedsRelogin(database: D1Database, id: string, reason: string): Promise<void> {
  await database
    .prepare("UPDATE accounts SET needs_relogin = 1, relogin_reason = ?, updated_at = ? WHERE id = ?")
    .bind(reason, Date.now(), id)
    .run();
}

export async function listRecentLogs(database: D1Database, limit = 50): Promise<CheckinLogRow[]> {
  const result = await database
    .prepare(
      "SELECT l.id, l.account_id, COALESCE(a.nickname, a.email, a.uid) AS account_name, l.local_date, l.status, l.message, l.created_at " +
        "FROM checkin_logs l LEFT JOIN accounts a ON a.id = l.account_id ORDER BY l.created_at DESC LIMIT ?",
    )
    .bind(limit)
    .all<CheckinLogRow>();
  return result.results;
}

export async function cleanupExpiredData(database: D1Database): Promise<void> {
  const now = Date.now();
  await database.batch([
    database.prepare("DELETE FROM oauth_sessions WHERE expires_at < ?").bind(now),
    database.prepare("DELETE FROM checkin_logs WHERE created_at < ?").bind(now - 30 * 24 * 60 * 60 * 1000),
    database
      .prepare("DELETE FROM login_rate_limits WHERE window_started_at < ? AND (blocked_until IS NULL OR blocked_until < ?)")
      .bind(Math.floor(now / 1000) - 24 * 60 * 60, Math.floor(now / 1000)),
  ]);
}
