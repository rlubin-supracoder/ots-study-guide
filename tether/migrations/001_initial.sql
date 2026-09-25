CREATE TABLE users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name TEXT, flight_number TEXT, room_number TEXT, phone_number TEXT,
  role TEXT NOT NULL CHECK(role IN ('member','admin')) DEFAULT 'member',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE checkouts (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  full_name TEXT NOT NULL, flight_number TEXT NOT NULL, room_number TEXT NOT NULL, phone_number TEXT NOT NULL,
  destination TEXT NOT NULL, checked_out_at TEXT NOT NULL, expected_return_at TEXT NOT NULL,
  checked_in_at TEXT, status TEXT NOT NULL CHECK(status IN ('ACTIVE','COMPLETED','ADMIN_CLOSED')),
  version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK ((status = 'ACTIVE' AND checked_in_at IS NULL) OR (status != 'ACTIVE' AND checked_in_at IS NOT NULL)),
  CHECK (checked_in_at IS NULL OR checked_in_at >= checked_out_at),
  CHECK (expected_return_at > checked_out_at)
);
CREATE UNIQUE INDEX one_active_checkout ON checkouts(user_id) WHERE status = 'ACTIVE';
CREATE INDEX roster_return ON checkouts(status, expected_return_at);
CREATE INDEX member_history ON checkouts(user_id, checked_out_at DESC);
CREATE INDEX flight_history ON checkouts(flight_number, checked_out_at DESC);
CREATE TABLE audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT REFERENCES users(id),
  subject_id TEXT REFERENCES users(id), record_id TEXT REFERENCES checkouts(id),
  action TEXT NOT NULL, at TEXT NOT NULL, detail TEXT NOT NULL
);
CREATE INDEX subject_audit ON audit(subject_id, id DESC);
CREATE TABLE requests (
  actor_id TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(actor_id, request_id)
);
CREATE TABLE limits (key TEXT PRIMARY KEY, window INTEGER NOT NULL, count INTEGER NOT NULL);
CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
