-- Comment moderation: an account barred from commenting, the warnings it received, and which
-- comments drew a warning. Additive only (new columns with defaults); the live Worker never reads
-- them. Per-hospital switches live in kv ('comments_off': JSON array of hospital ids).

ALTER TABLE accounts ADD COLUMN no_comment INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN warnings INTEGER NOT NULL DEFAULT 0;
ALTER TABLE comments ADD COLUMN warned_at INTEGER;
ALTER TABLE comments ADD COLUMN warned_by TEXT;
