CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  checkin_time TEXT NOT NULL DEFAULT '08:10',
  last_scheduled_date TEXT,
  scheduled_lock_until INTEGER,
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO app_settings (id, checkin_time, updated_at)
VALUES (1, '08:10', CAST(strftime('%s', 'now') AS INTEGER) * 1000);

CREATE TABLE IF NOT EXISTS admin_credentials (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  session_version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
