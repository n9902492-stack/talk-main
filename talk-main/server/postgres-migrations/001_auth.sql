-- PostgreSQL production schema; SQLite development migrations remain separate.
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  picture TEXT,
  email_verified BIGINT NOT NULL DEFAULT 0 CHECK(email_verified IN (0, 1)),
  created_at BIGINT NOT NULL
);

CREATE TABLE google_challenges (
  token_hash TEXT PRIMARY KEY,
  csrf_token TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at BIGINT NOT NULL
);

CREATE TABLE email_challenges (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  email TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('signup', 'existing', 'login', 'link')),
  staged_name TEXT,
  staged_password_hash TEXT,
  bound_session_hash TEXT,
  csrf_token TEXT NOT NULL,
  code_hash TEXT,
  generation BIGINT NOT NULL DEFAULT 1,
  attempts BIGINT NOT NULL DEFAULT 0,
  delivery_state TEXT NOT NULL CHECK(delivery_state IN ('sending', 'active', 'failed', 'used')),
  expires_at BIGINT NOT NULL,
  resend_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  flow_expires_at BIGINT NOT NULL
);

CREATE TABLE rate_limits (
  bucket TEXT PRIMARY KEY,
  count BIGINT NOT NULL,
  resets_at BIGINT NOT NULL
);

CREATE TABLE "identities" (
  provider TEXT NOT NULL CHECK(provider IN ('google', 'password', 'phone')),
  provider_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  password_hash TEXT,
  verified_at BIGINT,
  PRIMARY KEY(provider, provider_id),
  UNIQUE(provider, account_id)
);

CREATE TABLE "sessions" (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  csrf_token TEXT NOT NULL,
  auth_method TEXT NOT NULL CHECK(auth_method IN ('google', 'password', 'phone')),
  authenticated_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  requires_confirmation BIGINT NOT NULL DEFAULT 0 CHECK(requires_confirmation IN (0, 1))
);

CREATE TABLE phone_profiles (
  firebase_uid TEXT PRIMARY KEY,
  account_id TEXT NOT NULL UNIQUE REFERENCES accounts(id),
  phone_number TEXT NOT NULL UNIQUE,
  verified_at BIGINT NOT NULL
);

CREATE TABLE phone_challenges (
  token_hash TEXT PRIMARY KEY,
  csrf_token TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  intent TEXT NOT NULL CHECK(intent IN ('signin', 'link')),
  account_id TEXT REFERENCES accounts(id),
  bound_session_hash TEXT,
  attempts BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  resend_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  consumed_at BIGINT
);

CREATE TABLE phone_token_uses (
  token_hash TEXT PRIMARY KEY,
  expires_at BIGINT NOT NULL
);

CREATE INDEX email_challenges_email ON email_challenges(email, created_at);

CREATE INDEX email_challenges_expiry ON email_challenges(flow_expires_at);

CREATE INDEX rate_limits_expiry ON rate_limits(resets_at);

CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE INDEX phone_challenges_number ON phone_challenges(phone_number, resend_at);

CREATE INDEX phone_challenges_expiry ON phone_challenges(created_at);

CREATE INDEX phone_token_uses_expiry ON phone_token_uses(expires_at);
