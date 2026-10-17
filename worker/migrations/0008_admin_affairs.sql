-- Administrative Affairs division (الشؤون الإدارية): one per hospital, with its own job titles,
-- officers database, daily roster and monthly scheduler. Additive only: new beta-only tables and
-- columns; the live Worker never reads them.
--
-- The division's data has the same record shape as the doctors' data (see schema.sql: meta /
-- hospital / sched / resident) but lives in its own table, partitioned by hospital, and is only
-- served to the owner, the hospital's admins and the division's own accounts (see aa.js).

CREATE TABLE IF NOT EXISTS aa_records (
  hosp       TEXT    NOT NULL,
  coll       TEXT    NOT NULL,
  id         TEXT    NOT NULL,
  ord        REAL    NOT NULL DEFAULT 0,
  v          INTEGER NOT NULL DEFAULT 1,
  data       TEXT    NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  wid        TEXT,
  PRIMARY KEY (hosp, coll, id)
);
CREATE INDEX IF NOT EXISTS idx_aa_records_updated ON aa_records (hosp, updated_at);

-- Previous version of every changed or deleted division row (undo trail, kept 120 days).
CREATE TABLE IF NOT EXISTS aa_history (
  hid     INTEGER PRIMARY KEY AUTOINCREMENT,
  hosp    TEXT    NOT NULL,
  coll    TEXT    NOT NULL,
  id      TEXT    NOT NULL,
  v       INTEGER,
  data    TEXT,
  deleted INTEGER NOT NULL DEFAULT 0,
  ts      INTEGER NOT NULL,
  by      TEXT,
  msg     TEXT
);
CREATE INDEX IF NOT EXISTS idx_aa_history_ts  ON aa_history (hosp, ts);
CREATE INDEX IF NOT EXISTS idx_aa_history_rec ON aa_history (hosp, coll, id);

-- Officer accounts (roles aa_user / aa_admin): the job title chosen at sign-up.
ALTER TABLE accounts ADD COLUMN aa_job TEXT;
ALTER TABLE accounts ADD COLUMN aa_job_name TEXT;
