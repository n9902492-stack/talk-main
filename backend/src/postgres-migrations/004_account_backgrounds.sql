CREATE TABLE account_backgrounds (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  image_data TEXT NOT NULL,
  version TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
