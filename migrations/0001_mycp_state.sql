CREATE TABLE IF NOT EXISTS mycp_state (
  id TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
