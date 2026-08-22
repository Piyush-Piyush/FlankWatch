CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competitor TEXT NOT NULL,
  collector_id TEXT NOT NULL,
  run_timestamp TEXT NOT NULL,
  status TEXT NOT NULL,
  reasons TEXT,
  raw_json TEXT NOT NULL,
  field_count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS heals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collector_id TEXT NOT NULL,
  competitor TEXT NOT NULL,
  triggered_at TEXT NOT NULL,
  diagnosis TEXT NOT NULL,
  preview_result TEXT,
  approved_at TEXT,
  status TEXT NOT NULL,
  error TEXT
);
