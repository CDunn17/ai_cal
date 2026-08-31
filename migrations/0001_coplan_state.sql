CREATE TABLE IF NOT EXISTS coplan_state (
  id TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
