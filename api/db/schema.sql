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

-- Tracks on-demand collector builds while they run (AI generation takes
-- several minutes) and after they fail, so the dashboard can show real
-- pending/failed state instead of the request just hanging or vanishing.
-- On success the collector graduates into collectors.json and its row here
-- is marked done; failures keep the error for the user to see.
CREATE TABLE IF NOT EXISTS pending_collectors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  status TEXT NOT NULL,
  collector_id TEXT,
  error TEXT
);
