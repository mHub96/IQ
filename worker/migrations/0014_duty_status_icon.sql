-- The icon of an on-call status (the owner edits the list of statuses; each card keeps the icon it was
-- set with). Additive only.
ALTER TABLE duty_status ADD COLUMN icon TEXT;
