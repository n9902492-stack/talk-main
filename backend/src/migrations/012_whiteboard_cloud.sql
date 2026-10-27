ALTER TABLE talk_whiteboard_ai_jobs ADD COLUMN execution_kind TEXT NOT NULL DEFAULT 'local' CHECK(execution_kind IN('local','cloud'));
ALTER TABLE talk_whiteboard_ai_jobs ADD COLUMN cloud_approval_id TEXT;
ALTER TABLE talk_whiteboard_ai_jobs ADD COLUMN usage_json TEXT;
CREATE TABLE talk_whiteboard_ai_approvals (
 id TEXT PRIMARY KEY, board_id TEXT NOT NULL REFERENCES talk_whiteboards(id) ON DELETE CASCADE,
 meeting_id TEXT NOT NULL, requested_by TEXT NOT NULL, session_hash TEXT NOT NULL,
 operation TEXT NOT NULL, scope TEXT NOT NULL, source_revision INTEGER NOT NULL,
 source_json TEXT NOT NULL, selection_json TEXT NOT NULL, prompt TEXT NOT NULL,
 wire_json TEXT NOT NULL, payload_hash TEXT NOT NULL, config_hash TEXT NOT NULL,
 proof_hash TEXT NOT NULL, executable INTEGER NOT NULL DEFAULT 0,
 state TEXT NOT NULL CHECK(state IN('awaiting','consumed','cancelled')), job_id TEXT,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX talk_whiteboard_ai_approval_board ON talk_whiteboard_ai_approvals(board_id,expires_at);
-- Content-free reservations survive job deletion and uncertain provider outcomes.
CREATE TABLE talk_whiteboard_ai_usage (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL UNIQUE, approval_id TEXT NOT NULL UNIQUE,
 board_id TEXT NOT NULL, meeting_id TEXT NOT NULL, account_id TEXT NOT NULL,
 provider TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL,
 input_estimate INTEGER NOT NULL, output_limit INTEGER NOT NULL,
 currency TEXT, reserved_microunits INTEGER, usage_json TEXT,
 created_at INTEGER NOT NULL, sent_at INTEGER, finished_at INTEGER
);
CREATE INDEX talk_whiteboard_ai_usage_limits ON talk_whiteboard_ai_usage(created_at,status);
