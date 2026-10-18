-- Duty exchange approval (per hospital, off by default; kv 'exchange_approval' lists the hospitals
-- where it is on). One row per request; see worker/src/exchange.js. Additive only: a new table the
-- live Worker never reads.

CREATE TABLE IF NOT EXISTS exchange_requests (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  hosp           TEXT    NOT NULL,
  date           TEXT    NOT NULL,      -- DD/MM/YYYY, as on the roster
  spec           TEXT    NOT NULL,
  old_name       TEXT    NOT NULL,      -- who holds the duty
  new_name       TEXT    NOT NULL,      -- who takes it
  sched_id       TEXT    NOT NULL,      -- the roster entry (records.coll = 'sched')
  requester_id   TEXT,
  requester_name TEXT,
  owner_id       TEXT,                  -- the duty holder's account (null: none, or they asked themselves)
  status         TEXT    NOT NULL,      -- owner_pending | admin_pending | approved | rejected | cancelled
  owner_note     TEXT,
  owner_at       INTEGER,
  note           TEXT,                  -- the admin's note (or why it was rejected)
  admin_by       TEXT,
  admin_at       INTEGER,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_xreq_requester ON exchange_requests (requester_id, id);
CREATE INDEX IF NOT EXISTS idx_xreq_owner     ON exchange_requests (owner_id, id);
CREATE INDEX IF NOT EXISTS idx_xreq_status    ON exchange_requests (status, hosp);
CREATE INDEX IF NOT EXISTS idx_xreq_sched     ON exchange_requests (sched_id, status);
