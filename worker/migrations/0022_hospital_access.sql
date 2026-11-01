-- An account's standing in each hospital (access.js), and a device's claim on a password reset.
-- Additive only: existing accounts keep their role and hospitals, and an empty hosp_roles means exactly that.
--   hosp_roles    JSON { hospital: { r: role, s: specialty } } when the account's role differs between hospitals
--   cover         JSON [hospitals] of the linked resident record (a copy, so every request knows it without a read)
--   reset_ticket  hash of the secret held by the device that asked for the reset

ALTER TABLE accounts ADD COLUMN hosp_roles TEXT;
ALTER TABLE accounts ADD COLUMN cover TEXT;
ALTER TABLE accounts ADD COLUMN reset_ticket TEXT;

UPDATE accounts SET cover = (SELECT json_extract(r.data, '$.hospitals') FROM records r WHERE r.coll = 'resident' AND r.id = accounts.resident_id)
 WHERE resident_id IS NOT NULL;
