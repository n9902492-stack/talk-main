-- Existing signed-in sessions stay usable; only newly verified Google sign-ins
-- require the separate Talk confirmation screen.
ALTER TABLE sessions ADD COLUMN requires_confirmation INTEGER NOT NULL DEFAULT 0
  CHECK (requires_confirmation IN (0, 1));
