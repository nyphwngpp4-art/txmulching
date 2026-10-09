-- Local:  npx wrangler d1 migrations apply txm-leads --local
-- Remote: npx wrangler d1 migrations apply txm-leads --remote
-- The Worker also runs this SQL (IF NOT EXISTS) on first use so a missing
-- migration does not drop the request. Prefer applying it before launch so
-- production schema changes stay reviewed.

CREATE TABLE IF NOT EXISTS leads (
  request_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  forwarded_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_attempt_at TEXT,
  backup_alerted_at TEXT
);

CREATE TABLE IF NOT EXISTS demo_leads (
  request_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  ref TEXT
);

CREATE INDEX IF NOT EXISTS leads_unforwarded ON leads (forwarded_at, created_at);
