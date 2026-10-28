-- Fewer database reads (the free plan's daily read limit).
-- Additive only: change counters kept by triggers, and indexes for queries that read every row.

-- Change counters of the records table, raised by the triggers below on every insert, update and
-- delete, whatever code makes it:
--   'main'          everything but the ER scheduler
--   'er'            the ER scheduler
--   's:<hospital>'  that hospital's duties ('s:' for duties without a hospital)
--   'c:<coll>'      each other collection (resident, hospital, meta, icu, ...)
-- Answers built from the records are cached under the counter's value (worker/src/revcache.js), so a
-- cached answer is never served after a change. The 's:' and 'c:' keys also list the blocks the
-- database download is made of: each is cached on its own, so a change re-reads only its block.
CREATE TABLE IF NOT EXISTS data_rev (
  k TEXT PRIMARY KEY,
  n INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO data_rev (k, n) VALUES ('main', 1), ('er', 1);
-- Part of every cache key: copies cached before this table was ever made again are never used.
INSERT OR IGNORE INTO data_rev (k, n) VALUES ('epoch', abs(random() % 1000000000000));

CREATE TRIGGER IF NOT EXISTS trg_records_rev_ins AFTER INSERT ON records
BEGIN
  UPDATE data_rev SET n = n + 1 WHERE k = (CASE WHEN NEW.coll IN ('er', 'er_conflict') THEN 'er' ELSE 'main' END);
  INSERT INTO data_rev (k, n)
    SELECT CASE WHEN NEW.coll = 'sched' THEN 's:' || COALESCE(NEW.hosp, '') ELSE 'c:' || NEW.coll END, 1
     WHERE NEW.coll NOT IN ('er', 'er_conflict')
    ON CONFLICT (k) DO UPDATE SET n = n + 1;
END;

CREATE TRIGGER IF NOT EXISTS trg_records_rev_upd AFTER UPDATE ON records
BEGIN
  UPDATE data_rev SET n = n + 1 WHERE k = (CASE WHEN NEW.coll IN ('er', 'er_conflict') THEN 'er' ELSE 'main' END);
  INSERT INTO data_rev (k, n)
    SELECT CASE WHEN NEW.coll = 'sched' THEN 's:' || COALESCE(NEW.hosp, '') ELSE 'c:' || NEW.coll END, 1
     WHERE NEW.coll NOT IN ('er', 'er_conflict')
    ON CONFLICT (k) DO UPDATE SET n = n + 1;
  -- A row moved to another hospital or collection: its old block changed too.
  INSERT INTO data_rev (k, n)
    SELECT CASE WHEN OLD.coll = 'sched' THEN 's:' || COALESCE(OLD.hosp, '') ELSE 'c:' || OLD.coll END, 1
     WHERE OLD.coll NOT IN ('er', 'er_conflict') AND (OLD.coll IS NOT NEW.coll OR OLD.hosp IS NOT NEW.hosp)
    ON CONFLICT (k) DO UPDATE SET n = n + 1;
END;

CREATE TRIGGER IF NOT EXISTS trg_records_rev_del AFTER DELETE ON records
BEGIN
  UPDATE data_rev SET n = n + 1 WHERE k = (CASE WHEN OLD.coll IN ('er', 'er_conflict') THEN 'er' ELSE 'main' END);
  INSERT INTO data_rev (k, n)
    SELECT CASE WHEN OLD.coll = 'sched' THEN 's:' || COALESCE(OLD.hosp, '') ELSE 'c:' || OLD.coll END, 1
     WHERE OLD.coll NOT IN ('er', 'er_conflict')
    ON CONFLICT (k) DO UPDATE SET n = n + 1;
END;

-- The blocks of the rows already there (later ones are added by the triggers above).
INSERT OR IGNORE INTO data_rev (k, n)
  SELECT DISTINCT CASE WHEN coll = 'sched' THEN 's:' || COALESCE(hosp, '') ELSE 'c:' || coll END, 1
    FROM records WHERE coll NOT IN ('er', 'er_conflict');

-- A hospital's duties of given days (the on-call card checks).
CREATE INDEX IF NOT EXISTS idx_sched_date ON records (hosp, json_extract(data, '$.date')) WHERE coll = 'sched';

-- Duties of a month across the hospitals (My Duties): the month of a "D/M/YYYY" date as "YYYY-M".
CREATE INDEX IF NOT EXISTS idx_sched_month ON records (
  (substr(json_extract(data, '$.date'), -4) || '-' || CAST(substr(json_extract(data, '$.date'), instr(json_extract(data, '$.date'), '/') + 1) AS INTEGER))
) WHERE coll = 'sched';

-- Residents by the last 10 digits of their phone number (sign-up and rotator checks).
CREATE INDEX IF NOT EXISTS idx_resident_phone ON records (
  substr(replace(replace(replace(COALESCE(json_extract(data, '$.phone'), ''), ' ', ''), '-', ''), '+', ''), -10)
) WHERE coll = 'resident';

-- Rotator accounts not yet linked to a resident record (the 10-minute cron looks for them).
CREATE INDEX IF NOT EXISTS idx_accounts_unlinked_rotators ON accounts (created_at)
  WHERE role = 'rotator' AND status = 'active' AND resident_id IS NULL;
