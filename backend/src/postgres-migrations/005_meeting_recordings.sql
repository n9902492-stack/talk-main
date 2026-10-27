CREATE TABLE talk_recordings (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES talk_meetings(id),
  requested_by TEXT NOT NULL REFERENCES accounts(id),
  mode TEXT NOT NULL CHECK(mode IN ('audio','video')),
  language TEXT NOT NULL CHECK(language IN ('auto','en','hi')),
  status TEXT NOT NULL CHECK(status IN ('awaiting_consent','starting','recording','stopping','processing','completed','failed','deleted')),
  created_at BIGINT NOT NULL,
  started_at BIGINT,
  stopped_at BIGINT,
  duration_ms BIGINT NOT NULL DEFAULT 0,
  bytes BIGINT NOT NULL DEFAULT 0,
  mime_type TEXT,
  storage_key TEXT,
  output_path TEXT,
  recorder_identity TEXT NOT NULL UNIQUE,
  worker_id TEXT,
  lease_expires_at BIGINT,
  expires_at BIGINT NOT NULL,
  error_code TEXT,
  transcript_status TEXT NOT NULL DEFAULT 'not_started' CHECK(transcript_status IN ('not_started','queued','processing','completed','failed','unavailable','deleted')),
  transcript_language TEXT,
  transcript_error TEXT,
  deleted_at BIGINT
);
CREATE INDEX talk_recordings_meeting ON talk_recordings(meeting_id,created_at);
CREATE UNIQUE INDEX talk_recordings_one_capture ON talk_recordings(meeting_id) WHERE status IN ('awaiting_consent','starting','recording','stopping');
CREATE TABLE talk_recording_consents (
  recording_id TEXT NOT NULL REFERENCES talk_recordings(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  decision TEXT NOT NULL CHECK(decision IN ('accepted','declined')),
  decided_at BIGINT NOT NULL,
  notice_version TEXT NOT NULL,
  PRIMARY KEY(recording_id,account_id)
);
CREATE TABLE talk_recording_events (
  id TEXT PRIMARY KEY,
  recording_id TEXT NOT NULL REFERENCES talk_recordings(id),
  actor_account_id TEXT REFERENCES accounts(id),
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL
);
CREATE INDEX talk_recording_events_time ON talk_recording_events(recording_id,created_at);
CREATE TABLE talk_recording_jobs (
  id TEXT PRIMARY KEY,
  recording_id TEXT NOT NULL REFERENCES talk_recordings(id),
  kind TEXT NOT NULL CHECK(kind IN ('transcribe','delete')),
  status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed')),
  attempts BIGINT NOT NULL DEFAULT 0,
  next_run_at BIGINT NOT NULL,
  lease_owner TEXT,
  lease_expires_at BIGINT,
  error_code TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE(recording_id,kind)
);
CREATE INDEX talk_recording_jobs_due ON talk_recording_jobs(status,next_run_at);
CREATE TABLE talk_transcript_segments (
  recording_id TEXT NOT NULL REFERENCES talk_recordings(id),
  segment_index BIGINT NOT NULL,
  start_ms BIGINT NOT NULL,
  end_ms BIGINT NOT NULL,
  text TEXT NOT NULL,
  speaker TEXT,
  language TEXT,
  PRIMARY KEY(recording_id,segment_index)
);
