-- Opioid uses: the patient's statistics number ("الرقم الإحصائي", optional) and the diagnosis
-- (required for new uses; older records have none). Additive only.
ALTER TABLE opioid_moves ADD COLUMN patient_no TEXT;
ALTER TABLE opioid_moves ADD COLUMN diagnosis TEXT;
