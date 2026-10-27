CREATE TABLE talk_whiteboard_ai_jobs (
 id TEXT PRIMARY KEY, board_id TEXT NOT NULL REFERENCES talk_whiteboards(id) ON DELETE CASCADE,
 meeting_id TEXT NOT NULL REFERENCES talk_meetings(id), requested_by TEXT NOT NULL REFERENCES accounts(id), session_hash TEXT NOT NULL,
 request_id TEXT NOT NULL, request_hash TEXT NOT NULL, operation TEXT NOT NULL CHECK(operation IN('generate','summarize','cluster')),
 mode TEXT NOT NULL CHECK(mode IN('template','rules','ollama')), template TEXT, prompt TEXT NOT NULL,
 provider TEXT NOT NULL, model TEXT, source_revision INTEGER NOT NULL, source_json TEXT NOT NULL, selection_json TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('queued','processing','review_required','applied','failed','cancelled')),
 result_json TEXT, review_json TEXT, error_code TEXT, attempts INTEGER NOT NULL DEFAULT 0, retries INTEGER NOT NULL DEFAULT 0,
 claim_id TEXT, claimed_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 version INTEGER NOT NULL DEFAULT 1, applied_revision INTEGER,
 UNIQUE(board_id,requested_by,request_id)
);
CREATE INDEX talk_whiteboard_ai_queue ON talk_whiteboard_ai_jobs(status,claimed_at);
CREATE INDEX talk_whiteboard_ai_board ON talk_whiteboard_ai_jobs(board_id,created_at);
