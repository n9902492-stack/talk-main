CREATE TABLE talk_whiteboards (
 id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL UNIQUE REFERENCES talk_meetings(id),
 created_by TEXT NOT NULL REFERENCES accounts(id), title TEXT NOT NULL,
 state_json TEXT NOT NULL DEFAULT '{}', revision INTEGER NOT NULL DEFAULT 0,
 locked INTEGER NOT NULL DEFAULT 0 CHECK(locked IN(0,1)),
 default_edit INTEGER NOT NULL DEFAULT 0 CHECK(default_edit IN(0,1)),
 history_bytes INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE TABLE talk_whiteboard_permissions (
 board_id TEXT NOT NULL REFERENCES talk_whiteboards(id) ON DELETE CASCADE,
 account_id TEXT NOT NULL REFERENCES accounts(id), can_edit INTEGER NOT NULL CHECK(can_edit IN(0,1)),
 PRIMARY KEY(board_id,account_id)
);
CREATE TABLE talk_whiteboard_operations (
 board_id TEXT NOT NULL REFERENCES talk_whiteboards(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL, request_id TEXT NOT NULL, actor_account_id TEXT NOT NULL REFERENCES accounts(id),
 request_hash TEXT NOT NULL, changes_json TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL,
 created_at INTEGER NOT NULL, PRIMARY KEY(board_id,revision), UNIQUE(board_id,request_id)
);
CREATE TABLE talk_whiteboard_snapshots (
 board_id TEXT NOT NULL REFERENCES talk_whiteboards(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL, state_json TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(board_id,revision)
);
CREATE TABLE talk_whiteboard_images (
 id TEXT PRIMARY KEY, board_id TEXT NOT NULL REFERENCES talk_whiteboards(id) ON DELETE CASCADE,
 created_by TEXT NOT NULL REFERENCES accounts(id), image_data TEXT NOT NULL,
 width INTEGER NOT NULL, height INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE talk_whiteboard_events (
 id TEXT PRIMARY KEY, board_id TEXT NOT NULL REFERENCES talk_whiteboards(id) ON DELETE CASCADE,
 actor_account_id TEXT NOT NULL REFERENCES accounts(id), action TEXT NOT NULL, detail_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
);
CREATE INDEX talk_whiteboards_expiry ON talk_whiteboards(expires_at);
CREATE TABLE talk_whiteboard_versions (
 board_id TEXT NOT NULL REFERENCES talk_whiteboards(id) ON DELETE CASCADE,
 object_id TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(board_id,object_id)
);
CREATE INDEX talk_whiteboard_events_time ON talk_whiteboard_events(board_id,created_at);
