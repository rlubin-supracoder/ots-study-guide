CREATE TABLE daily_reports (
  report_date TEXT PRIMARY KEY,
  scheduled_for TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  user_count INTEGER NOT NULL,
  file BLOB NOT NULL
);
