-- Hospital Hub D1 schema.
-- Every piece of shared data is one row in `records`, addressed by (coll, id):
--   meta      id = top-level key (globalSpecialties, specialists, version, ...)
--   hospital  id = hospital id      (hospital object without schedule / icu / passwords)
--   icu       id = hospital id      (ICU bed status)
--   sched     id = "<hospital>:<entry id>"  (one duty slot)
--   resident  id = resident id
--   er        id = localStorage key of the ER scheduler (monthly schedules, allocations, state)
-- `v` is a per-row version used for optimistic concurrency; `wid` identifies the write that set it.

CREATE TABLE IF NOT EXISTS records (
  coll       TEXT    NOT NULL,
  id         TEXT    NOT NULL,
  hosp       TEXT,
  ord        REAL    NOT NULL DEFAULT 0,
  v          INTEGER NOT NULL DEFAULT 1,
  data       TEXT    NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  wid        TEXT,
  PRIMARY KEY (coll, id)
);
CREATE INDEX IF NOT EXISTS idx_records_coll_hosp ON records (coll, hosp);
CREATE INDEX IF NOT EXISTS idx_records_updated ON records (updated_at);

-- Previous version of every changed or deleted row (the undo / backup trail).
CREATE TABLE IF NOT EXISTS history (
  hid     INTEGER PRIMARY KEY AUTOINCREMENT,
  coll    TEXT    NOT NULL,
  id      TEXT    NOT NULL,
  hosp    TEXT,
  v       INTEGER,
  data    TEXT,
  deleted INTEGER NOT NULL DEFAULT 0,
  ts      INTEGER NOT NULL,
  by      TEXT,
  msg     TEXT
);
CREATE INDEX IF NOT EXISTS idx_history_ts  ON history (ts);
CREATE INDEX IF NOT EXISTS idx_history_rec ON history (coll, id);

-- Role passwords, AES-GCM encrypted with the PW_KEY secret. scope = 'global' or a hospital id.
CREATE TABLE IF NOT EXISTS secrets (
  scope TEXT NOT NULL,
  role  TEXT NOT NULL,
  enc   TEXT NOT NULL,
  PRIMARY KEY (scope, role)
);

CREATE TABLE IF NOT EXISTS kv (
  k TEXT PRIMARY KEY,
  v TEXT
);

-- Failed login counter per IP per 10-minute bucket.
CREATE TABLE IF NOT EXISTS login_fail (
  ip     TEXT    NOT NULL,
  bucket INTEGER NOT NULL,
  n      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, bucket)
);

-- One line per save: who, when, what (replaces the git commit log).
CREATE TABLE IF NOT EXISTS audit (
  aid  INTEGER PRIMARY KEY AUTOINCREMENT,
  ts   INTEGER NOT NULL,
  role TEXT,
  msg  TEXT,
  n    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit (ts);
