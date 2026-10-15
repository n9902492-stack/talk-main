-- Extend the existing identity/session tables without changing account IDs,
-- password hashes, Google subjects or active cookie sessions.
CREATE TABLE identities_phone_migration (
  provider TEXT NOT NULL CHECK(provider IN ('google', 'password', 'phone')),
  provider_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  password_hash TEXT,
  verified_at INTEGER,
  PRIMARY KEY(provider, provider_id),
  UNIQUE(provider, account_id)
);
INSERT INTO identities_phone_migration SELECT * FROM identities;
DROP TABLE identities;
ALTER TABLE identities_phone_migration RENAME TO identities;

CREATE TABLE sessions_phone_migration (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  csrf_token TEXT NOT NULL,
  auth_method TEXT NOT NULL CHECK(auth_method IN ('google', 'password', 'phone')),
  authenticated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  requires_confirmation INTEGER NOT NULL DEFAULT 0 CHECK(requires_confirmation IN (0, 1))
);
INSERT INTO sessions_phone_migration SELECT * FROM sessions;
DROP TABLE sessions;
ALTER TABLE sessions_phone_migration RENAME TO sessions;
CREATE INDEX sessions_expiry ON sessions(expires_at);

-- Firebase UID is the identity. The unique verified number prevents implicit
-- merges when Firebase changes or a different UID claims the same number.
CREATE TABLE phone_profiles (
  firebase_uid TEXT PRIMARY KEY,
  account_id TEXT NOT NULL UNIQUE REFERENCES accounts(id),
  phone_number TEXT NOT NULL UNIQUE,
  verified_at INTEGER NOT NULL
);
CREATE TABLE phone_challenges (
  token_hash TEXT PRIMARY KEY,
  csrf_token TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  intent TEXT NOT NULL CHECK(intent IN ('signin', 'link')),
  account_id TEXT REFERENCES accounts(id),
  bound_session_hash TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  resend_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX phone_challenges_number ON phone_challenges(phone_number, resend_at);
CREATE INDEX phone_challenges_expiry ON phone_challenges(created_at);
CREATE TABLE phone_token_uses (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX phone_token_uses_expiry ON phone_token_uses(expires_at);
