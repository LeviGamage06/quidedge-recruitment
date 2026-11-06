-- Operational metadata only. Recruitment events remain append-only.
CREATE TABLE IF NOT EXISTS request_buckets (
 bucket TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS document_outbox (
 id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
 document_type TEXT NOT NULL, event_date TEXT NOT NULL, payload TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS document_outbox_state ON document_outbox(state,created_at);
CREATE TABLE IF NOT EXISTS maintenance_state (
 key TEXT PRIMARY KEY, value TEXT NOT NULL
);
