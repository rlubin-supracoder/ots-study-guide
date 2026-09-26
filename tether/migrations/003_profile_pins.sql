CREATE TABLE profile_pins (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK(failed_attempts BETWEEN 0 AND 5),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
