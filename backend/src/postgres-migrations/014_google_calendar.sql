CREATE TABLE talk_calendar_connections (
 host_id TEXT PRIMARY KEY REFERENCES accounts(id), id TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL CHECK(status IN ('connected','disconnected','reconnect_required')),
 account_email TEXT, account_subject TEXT, token_cipher TEXT, calendar_id TEXT NOT NULL DEFAULT 'primary',
 settings TEXT NOT NULL, scopes TEXT NOT NULL DEFAULT '[]', sync_cipher TEXT,
 revision BIGINT NOT NULL DEFAULT 1, refresh_owner TEXT, refresh_until BIGINT, sync_owner TEXT, sync_until BIGINT, last_sync_at BIGINT, error_code TEXT, updated_at BIGINT NOT NULL
);
CREATE TABLE talk_calendar_oauth_states (
 state_hash TEXT PRIMARY KEY, host_id TEXT NOT NULL REFERENCES accounts(id), session_hash TEXT NOT NULL,
 verifier_cipher TEXT NOT NULL, connection_revision BIGINT NOT NULL DEFAULT 0, expires_at BIGINT NOT NULL, consumed BIGINT NOT NULL DEFAULT 0 CHECK(consumed IN(0,1))
);
CREATE INDEX talk_calendar_oauth_expiry ON talk_calendar_oauth_states(expires_at);
CREATE TABLE talk_calendar_events (
 booking_id TEXT PRIMARY KEY REFERENCES scheduling_bookings(id), host_id TEXT NOT NULL REFERENCES accounts(id),
 connection_id TEXT NOT NULL, calendar_id TEXT NOT NULL, event_id TEXT NOT NULL, event_url TEXT,
 status TEXT NOT NULL CHECK(status IN ('pending','synced','cancelled','failed','conflict')),
 etag TEXT, payload_hash TEXT, booking_version BIGINT, last_sync_at BIGINT, error_code TEXT,
 attendee_status TEXT NOT NULL DEFAULT '[]', UNIQUE(connection_id,calendar_id,event_id)
);
CREATE TABLE talk_calendar_jobs (
 id TEXT PRIMARY KEY, host_id TEXT NOT NULL REFERENCES accounts(id), booking_id TEXT NOT NULL REFERENCES scheduling_bookings(id),
 connection_id TEXT NOT NULL, signature TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','processing','done','failed','cancelled')),
 attempts BIGINT NOT NULL DEFAULT 0, due_at BIGINT NOT NULL, lease_until BIGINT, worker_id TEXT, error_code TEXT, force_sync BIGINT NOT NULL DEFAULT 0,
 UNIQUE(booking_id,connection_id,signature)
);
CREATE INDEX talk_calendar_jobs_due ON talk_calendar_jobs(status,due_at,lease_until);
CREATE TABLE talk_calendar_conflicts (
 id TEXT PRIMARY KEY, host_id TEXT NOT NULL REFERENCES accounts(id), booking_id TEXT NOT NULL REFERENCES scheduling_bookings(id),
 event_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('external_edit','external_cancel','external_busy','attendee_review')),
 remote_etag TEXT NOT NULL, remote_start BIGINT, remote_end BIGINT,
 resolution TEXT NOT NULL DEFAULT 'pending' CHECK(resolution IN ('pending','dismissed','reasserted')),
 created_at BIGINT NOT NULL, UNIQUE(host_id,booking_id,event_id,kind,remote_etag)
);
