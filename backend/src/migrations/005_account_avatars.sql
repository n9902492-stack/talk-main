CREATE TABLE account_avatars (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('default','initials','preset','upload')),
  preset_id TEXT,
  image_data TEXT,
  version TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
