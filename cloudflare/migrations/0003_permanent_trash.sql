-- Permanent removal is allowed only for the exact IDs in a server-validated purge job.
DROP TRIGGER IF EXISTS recruitment_events_no_delete;
CREATE TRIGGER recruitment_events_no_delete BEFORE DELETE ON recruitment_events
WHEN NOT EXISTS (SELECT 1 FROM maintenance_state m,json_each(json_extract(m.value,'$.event_ids')) i WHERE m.key='purge_active' AND json_extract(m.value,'$.phase')='database' AND i.value=OLD.id)
BEGIN SELECT RAISE(ABORT,'Permanent deletion requires a validated Trash cleanup'); END;
CREATE TRIGGER IF NOT EXISTS recruitment_events_purge_freeze BEFORE INSERT ON recruitment_events
WHEN EXISTS (SELECT 1 FROM maintenance_state WHERE key='purge_active')
BEGIN SELECT RAISE(ABORT,'Trash cleanup in progress'); END;
CREATE TRIGGER IF NOT EXISTS document_outbox_purge_freeze BEFORE INSERT ON document_outbox
WHEN EXISTS (SELECT 1 FROM maintenance_state WHERE key='purge_active')
BEGIN SELECT RAISE(ABORT,'Trash cleanup in progress'); END;
CREATE TRIGGER IF NOT EXISTS interview_settings_purge_freeze BEFORE INSERT ON maintenance_state
WHEN NEW.key LIKE 'interview:%' AND EXISTS (SELECT 1 FROM maintenance_state WHERE key='purge_active')
BEGIN SELECT RAISE(ABORT,'Trash cleanup in progress'); END;
