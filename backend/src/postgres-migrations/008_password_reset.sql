CREATE TABLE password_reset_challenges (
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
 account_id TEXT REFERENCES accounts(id), email TEXT NOT NULL,
 password_version TEXT, code_hash TEXT, csrf_token TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN('queued','sending','active','failed','verified','used')),
 attempts INTEGER NOT NULL DEFAULT 0, deliveries INTEGER NOT NULL DEFAULT 0,
 claim_id TEXT, claimed_at BIGINT, expires_at BIGINT NOT NULL,
 resend_at BIGINT NOT NULL, created_at BIGINT NOT NULL, flow_expires_at BIGINT NOT NULL
);
CREATE INDEX password_reset_email ON password_reset_challenges(email,resend_at);
CREATE INDEX password_reset_jobs ON password_reset_challenges(state,claimed_at);
