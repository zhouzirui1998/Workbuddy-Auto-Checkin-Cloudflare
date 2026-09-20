PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  nickname TEXT,
  email TEXT,
  enterprise_id TEXT,
  enterprise_name TEXT,
  domain TEXT NOT NULL DEFAULT '',
  credential_ciphertext TEXT NOT NULL,
  credential_iv TEXT NOT NULL,
  expires_at INTEGER,
  refresh_expires_at INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  needs_relogin INTEGER NOT NULL DEFAULT 0 CHECK (needs_relogin IN (0, 1)),
  relogin_reason TEXT,
  last_checkin_status TEXT,
  last_checkin_message TEXT,
  last_checkin_at INTEGER,
  checkin_lock_until INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (uid, domain)
);

CREATE TABLE IF NOT EXISTS oauth_sessions (
  id TEXT PRIMARY KEY,
  payload_ciphertext TEXT NOT NULL,
  payload_iv TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS checkin_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  local_date TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS login_rate_limits (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  window_started_at INTEGER NOT NULL,
  blocked_until INTEGER
);

CREATE INDEX IF NOT EXISTS idx_accounts_enabled ON accounts(enabled);
CREATE INDEX IF NOT EXISTS idx_oauth_sessions_expires ON oauth_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_checkin_logs_created ON checkin_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkin_logs_account ON checkin_logs(account_id, created_at DESC);
