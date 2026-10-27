ALTER TABLE scheduling_jobs ADD COLUMN delivery_outcome TEXT CHECK(delivery_outcome IS NULL OR delivery_outcome IN ('CONFIRMED_ACCEPTED','CONFIRMED_REJECTED','CONFIRMED_NOT_SUBMITTED','UNKNOWN_AMBIGUOUS'));
CREATE TABLE scheduling_email_attempts (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES scheduling_jobs(id), attempt_number INTEGER NOT NULL,
 message_id TEXT NOT NULL, started_at BIGINT NOT NULL, completed_at BIGINT,
 outcome TEXT NOT NULL CHECK(outcome IN ('IN_PROGRESS','CONFIRMED_ACCEPTED','CONFIRMED_REJECTED','CONFIRMED_NOT_SUBMITTED','UNKNOWN_AMBIGUOUS')),
 phase TEXT NOT NULL, smtp_code INTEGER, error_category TEXT, retryable INTEGER NOT NULL DEFAULT 0 CHECK(retryable IN (0,1)),
 events_json TEXT NOT NULL DEFAULT '[]' CHECK(length(events_json)<=16384),
 UNIQUE(job_id,attempt_number)
);
CREATE INDEX scheduling_email_attempts_job ON scheduling_email_attempts(job_id,attempt_number);
CREATE INDEX scheduling_email_attempts_started ON scheduling_email_attempts(started_at);
