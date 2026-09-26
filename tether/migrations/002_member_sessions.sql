CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('gate','device','connect')),
  user_id TEXT REFERENCES users(id),
  password_version TEXT,
  join_hash TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id,kind);
CREATE INDEX sessions_expiry ON sessions(expires_at);
ALTER TABLE users ADD COLUMN account_type TEXT NOT NULL DEFAULT 'email' CHECK(account_type IN ('email','device'));
