CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  picture TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK(email_verified IN (0, 1)),
  created_at INTEGER NOT NULL
);
CREATE TABLE identities (
  provider TEXT NOT NULL CHECK(provider IN ('google', 'password')),
  provider_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  password_hash TEXT,
  verified_at INTEGER,
  PRIMARY KEY(provider, provider_id),
  UNIQUE(provider, account_id)
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  csrf_token TEXT NOT NULL,
  auth_method TEXT NOT NULL CHECK(auth_method IN ('google', 'password')),
  authenticated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE google_challenges (
  token_hash TEXT PRIMARY KEY,
  csrf_token TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL
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
  generation INTEGER NOT NULL DEFAULT 1,
  attempts INTEGER NOT NULL DEFAULT 0,
  delivery_state TEXT NOT NULL CHECK(delivery_state IN ('sending', 'active', 'failed', 'used')),
  expires_at INTEGER NOT NULL,
  resend_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  flow_expires_at INTEGER NOT NULL
);
CREATE INDEX email_challenges_email ON email_challenges(email, created_at);
CREATE INDEX email_challenges_expiry ON email_challenges(flow_expires_at);
CREATE TABLE rate_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  resets_at INTEGER NOT NULL
);
CREATE INDEX rate_limits_expiry ON rate_limits(resets_at);
