CREATE TABLE recruitment_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('job','candidate','stage','activity','summary','score')),
  subject_id TEXT REFERENCES recruitment_events(id),
  event_date TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload) AND json_type(payload) = 'object'),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK ((kind IN ('stage','activity','score')) = (subject_id IS NOT NULL))
);

CREATE TRIGGER recruitment_events_no_update BEFORE UPDATE ON recruitment_events
BEGIN
  SELECT RAISE(ABORT, 'Recruitment records are append-only');
END;

CREATE TRIGGER recruitment_events_no_delete BEFORE DELETE ON recruitment_events
BEGIN
  SELECT RAISE(ABORT, 'Recruitment records are append-only');
END;

CREATE INDEX recruitment_events_subject_seq ON recruitment_events(subject_id, seq);

CREATE INDEX recruitment_events_kind_seq ON recruitment_events(kind, seq);

