-- Resident profile (board, specialty, stage with yearly level-up) and per-card keys for the
-- "comments I received" view. Additive only: new columns on beta-only tables.

ALTER TABLE accounts ADD COLUMN board TEXT;          -- arab | iraqi | other | none
ALTER TABLE accounts ADD COLUMN specialty TEXT;
ALTER TABLE accounts ADD COLUMN stage INTEGER;       -- stage at stage_ref (current stage is computed)
ALTER TABLE accounts ADD COLUMN stage_ref INTEGER;   -- when `stage` was set (ms)
ALTER TABLE accounts ADD COLUMN board_years INTEGER; -- length of the board programme; the stage stops there
ALTER TABLE accounts ADD COLUMN profile_src TEXT;    -- auto | user | owner (who last set the profile)

ALTER TABLE comments ADD COLUMN card_key TEXT;       -- normalised resident name of the card
ALTER TABLE comments ADD COLUMN card_date TEXT;      -- YYYY-MM-DD duty day of the card
ALTER TABLE comments ADD COLUMN edited_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_comments_card_key ON comments (card_key, cid);

ALTER TABLE likes ADD COLUMN card_key TEXT;
CREATE INDEX IF NOT EXISTS idx_likes_card_key ON likes (card_key);
