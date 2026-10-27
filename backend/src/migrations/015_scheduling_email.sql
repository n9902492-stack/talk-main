ALTER TABLE scheduling_jobs ADD COLUMN recipient TEXT NOT NULL DEFAULT 'invitee' CHECK(recipient IN ('host','invitee'));
ALTER TABLE scheduling_jobs ADD COLUMN expires_at INTEGER;
