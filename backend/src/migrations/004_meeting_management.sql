CREATE TABLE talk_meetings (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  room_name TEXT NOT NULL UNIQUE,
  owner_account_id TEXT NOT NULL REFERENCES accounts(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','ended')),
  locked INTEGER NOT NULL DEFAULT 0 CHECK(locked IN (0,1)),
  approval_required INTEGER NOT NULL DEFAULT 1 CHECK(approval_required IN (0,1)),
  created_at INTEGER NOT NULL,
  ended_at INTEGER
);
CREATE TABLE talk_meeting_members (
  meeting_id TEXT NOT NULL REFERENCES talk_meetings(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('host','cohost','member')),
  admission TEXT NOT NULL CHECK(admission IN ('pending','admitted','denied','removed')),
  display_name TEXT NOT NULL,
  can_audio INTEGER NOT NULL DEFAULT 1,
  can_video INTEGER NOT NULL DEFAULT 1,
  hand_at INTEGER,
  mute_requested_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(meeting_id,account_id)
);
CREATE TABLE talk_meeting_connections (
  identity TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES talk_meetings(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  session_hash TEXT NOT NULL,
  ticket_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(meeting_id,account_id) REFERENCES talk_meeting_members(meeting_id,account_id)
);
CREATE INDEX talk_connections_member ON talk_meeting_connections(meeting_id,account_id);
CREATE TABLE talk_meeting_events (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES talk_meetings(id),
  actor_account_id TEXT NOT NULL REFERENCES accounts(id),
  target_account_id TEXT,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX talk_events_time ON talk_meeting_events(meeting_id,created_at);
