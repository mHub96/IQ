-- Opioid log entries can be edited (by the owner, the hospital's admins, the holder): who and when. Additive only.
ALTER TABLE opioid_moves ADD COLUMN edited_at INTEGER;
ALTER TABLE opioid_moves ADD COLUMN edited_by TEXT;
