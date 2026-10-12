-- Local:  npx wrangler d1 migrations apply txm-leads --local
-- Remote: npx wrangler d1 migrations apply txm-leads --remote
-- Keeps spam rows in D1 (status = 'spam') without forwarding them.
-- Existing rows become 'new'. The Worker also adds this column on first use
-- when it is missing. If this migration reports "duplicate column name: status",
-- the Worker already added it and the schema is already correct.

ALTER TABLE leads ADD COLUMN status TEXT NOT NULL DEFAULT 'new';
