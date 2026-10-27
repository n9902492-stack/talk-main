CREATE TABLE talk_transcript_revisions (
  id TEXT PRIMARY KEY,
  recording_id TEXT NOT NULL REFERENCES talk_recordings(id),
  revision BIGINT NOT NULL CHECK(revision > 0),
  content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
  language TEXT NOT NULL,
  segments_json TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  UNIQUE(recording_id,revision)
);
CREATE INDEX talk_transcript_revisions_recording ON talk_transcript_revisions(recording_id,revision);
CREATE TABLE talk_ai_consents (
  recording_id TEXT NOT NULL REFERENCES talk_recordings(id),
  transcript_revision_id TEXT NOT NULL REFERENCES talk_transcript_revisions(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  notice_version TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('accepted','declined')),
  decided_at BIGINT NOT NULL,
  PRIMARY KEY(recording_id,transcript_revision_id,account_id,notice_version)
);
CREATE TABLE talk_ai_reports (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES talk_meetings(id),
  created_by TEXT NOT NULL REFERENCES accounts(id),
  status TEXT NOT NULL CHECK(status IN ('draft','processing','review_required','approved','failed','cancelled')),
  source_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  current_revision BIGINT NOT NULL DEFAULT 0,
  approved_revision BIGINT,
  deleted_at BIGINT,
  error_code TEXT
);
CREATE INDEX talk_ai_reports_meeting ON talk_ai_reports(meeting_id,created_at);
CREATE TABLE talk_ai_report_sources (
  report_id TEXT NOT NULL REFERENCES talk_ai_reports(id) ON DELETE CASCADE,
  recording_id TEXT NOT NULL REFERENCES talk_recordings(id),
  transcript_revision_id TEXT NOT NULL REFERENCES talk_transcript_revisions(id) ON DELETE CASCADE,
  ordinal BIGINT NOT NULL,
  PRIMARY KEY(report_id,recording_id),
  UNIQUE(report_id,ordinal)
);
CREATE INDEX talk_ai_sources_transcript ON talk_ai_report_sources(transcript_revision_id);
CREATE TABLE talk_ai_report_revisions (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES talk_ai_reports(id) ON DELETE CASCADE,
  revision BIGINT NOT NULL CHECK(revision > 0),
  content_json TEXT NOT NULL,
  origin TEXT NOT NULL CHECK(origin IN ('ai','manager')),
  author_account_id TEXT REFERENCES accounts(id),
  model_digest TEXT,
  prompt_version TEXT,
  schema_version TEXT,
  created_at BIGINT NOT NULL,
  UNIQUE(report_id,revision)
);
CREATE TABLE talk_ai_jobs (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES talk_ai_reports(id) ON DELETE CASCADE,
  requested_by TEXT NOT NULL REFERENCES accounts(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed','cancelled')),
  attempts BIGINT NOT NULL DEFAULT 0,
  next_run_at BIGINT NOT NULL,
  lease_owner TEXT,
  lease_expires_at BIGINT,
  checkpoint_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX talk_ai_jobs_due ON talk_ai_jobs(status,next_run_at);
CREATE INDEX talk_ai_jobs_report ON talk_ai_jobs(report_id);
CREATE TABLE talk_ai_events (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES talk_ai_reports(id) ON DELETE CASCADE,
  actor_account_id TEXT REFERENCES accounts(id),
  action TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL
);
CREATE INDEX talk_ai_events_report ON talk_ai_events(report_id,created_at);
CREATE FUNCTION talk_reject_immutable_revision_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Transcript and AI report revisions are immutable.';
END;
$$;
CREATE TRIGGER talk_transcript_revision_immutable
BEFORE UPDATE ON talk_transcript_revisions FOR EACH ROW
EXECUTE FUNCTION talk_reject_immutable_revision_update();
CREATE TRIGGER talk_ai_report_revision_immutable
BEFORE UPDATE ON talk_ai_report_revisions FOR EACH ROW
EXECUTE FUNCTION talk_reject_immutable_revision_update();
