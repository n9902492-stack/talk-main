CREATE TABLE scheduling_profiles (
 host_id TEXT PRIMARY KEY REFERENCES accounts(id), slug TEXT NOT NULL UNIQUE,
 timezone TEXT NOT NULL, settings TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL
);
CREATE TABLE scheduling_challenges (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE scheduling_events (
 id TEXT PRIMARY KEY, host_id TEXT NOT NULL REFERENCES scheduling_profiles(host_id), slug TEXT NOT NULL,
 title TEXT NOT NULL, duration INTEGER NOT NULL CHECK(duration BETWEEN 5 AND 240), capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 20),
 settings TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)), created_at INTEGER NOT NULL,
 UNIQUE(host_id,slug)
);
CREATE TABLE scheduling_windows (
 id TEXT PRIMARY KEY, host_id TEXT NOT NULL REFERENCES scheduling_profiles(host_id), weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
 start_minute INTEGER NOT NULL CHECK(start_minute BETWEEN 0 AND 1439), end_minute INTEGER NOT NULL CHECK(end_minute BETWEEN 1 AND 1440),
 CHECK(end_minute>start_minute)
);
CREATE TABLE scheduling_overrides (
 id TEXT PRIMARY KEY, host_id TEXT NOT NULL REFERENCES scheduling_profiles(host_id), local_date TEXT NOT NULL,
 windows TEXT NOT NULL, UNIQUE(host_id,local_date)
);
CREATE TABLE scheduling_occurrences (
 id TEXT PRIMARY KEY, host_id TEXT NOT NULL REFERENCES scheduling_profiles(host_id), event_id TEXT NOT NULL REFERENCES scheduling_events(id),
 starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL CHECK(ends_at>starts_at), meeting_id TEXT NOT NULL UNIQUE REFERENCES talk_meetings(id),
 status TEXT NOT NULL CHECK(status IN ('confirmed','cancelled'))
);
CREATE UNIQUE INDEX scheduling_live_occurrence ON scheduling_occurrences(event_id,starts_at) WHERE status='confirmed';
CREATE INDEX scheduling_occurrences_host_time ON scheduling_occurrences(host_id,starts_at,ends_at,status);
CREATE TABLE scheduling_bookings (
 id TEXT PRIMARY KEY, occurrence_id TEXT NOT NULL REFERENCES scheduling_occurrences(id), host_id TEXT NOT NULL REFERENCES scheduling_profiles(host_id),
 name TEXT NOT NULL, email TEXT NOT NULL, timezone TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('confirmed','cancelled')),
 manage_hash TEXT NOT NULL UNIQUE, idempotency_hash TEXT NOT NULL, request_hash TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, answers_expire_at INTEGER NOT NULL,
 UNIQUE(host_id,idempotency_hash)
);
CREATE INDEX scheduling_bookings_occurrence ON scheduling_bookings(occurrence_id,status);
CREATE TABLE scheduling_attendees (
 id TEXT PRIMARY KEY, booking_id TEXT NOT NULL UNIQUE REFERENCES scheduling_bookings(id), meeting_id TEXT NOT NULL REFERENCES talk_meetings(id),
 admission TEXT NOT NULL DEFAULT 'new' CHECK(admission IN ('new','pending','admitted','denied','removed')),
 can_audio INTEGER NOT NULL DEFAULT 1, can_video INTEGER NOT NULL DEFAULT 1, hand_at INTEGER, mute_requested_at INTEGER, attended_at INTEGER
);
CREATE TABLE scheduling_invitations (
 id TEXT PRIMARY KEY, booking_id TEXT NOT NULL REFERENCES scheduling_bookings(id), token_hash TEXT NOT NULL UNIQUE,
 expires_at INTEGER NOT NULL, redeemed_at INTEGER, revoked INTEGER NOT NULL DEFAULT 0,
 proof_hash TEXT, proof_expires_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE scheduling_guest_sessions (
 token_hash TEXT PRIMARY KEY, invitation_id TEXT NOT NULL REFERENCES scheduling_invitations(id), attendee_id TEXT NOT NULL REFERENCES scheduling_attendees(id),
 csrf_token TEXT NOT NULL, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE scheduling_guest_connections (
 identity TEXT PRIMARY KEY, attendee_id TEXT NOT NULL REFERENCES scheduling_attendees(id), meeting_id TEXT NOT NULL REFERENCES talk_meetings(id),
 session_hash TEXT NOT NULL REFERENCES scheduling_guest_sessions(token_hash), ticket_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE scheduling_questions (
 event_id TEXT NOT NULL REFERENCES scheduling_events(id), id TEXT NOT NULL, definition TEXT NOT NULL, PRIMARY KEY(event_id,id)
);
CREATE TABLE scheduling_answers (
 booking_id TEXT PRIMARY KEY REFERENCES scheduling_bookings(id), schema_snapshot TEXT NOT NULL, answers TEXT NOT NULL
);
CREATE TABLE scheduling_jobs (
 id TEXT PRIMARY KEY, booking_id TEXT NOT NULL REFERENCES scheduling_bookings(id), booking_version INTEGER NOT NULL, kind TEXT NOT NULL,
 due_at INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('queued','sending','sent','failed','cancelled')),
 attempts INTEGER NOT NULL DEFAULT 0, lease_until INTEGER, worker_id TEXT, error_code TEXT,
 UNIQUE(booking_id,booking_version,kind)
);
CREATE INDEX scheduling_jobs_due ON scheduling_jobs(status,due_at,lease_until);
CREATE TABLE scheduling_audit (
 id TEXT PRIMARY KEY, host_id TEXT NOT NULL REFERENCES accounts(id), booking_id TEXT REFERENCES scheduling_bookings(id), action TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE scheduling_calendar_connections (
 id TEXT PRIMARY KEY, host_id TEXT NOT NULL REFERENCES accounts(id), provider TEXT NOT NULL CHECK(provider='ics'),
 status TEXT NOT NULL CHECK(status='local'), created_at INTEGER NOT NULL, UNIQUE(host_id,provider)
);
CREATE TABLE scheduling_metrics (
 event_id TEXT NOT NULL REFERENCES scheduling_events(id), local_date TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('visit','selection')),
 count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(event_id,local_date,kind)
);
