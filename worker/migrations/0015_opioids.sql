-- The opioids responsibility ("ذمة المخدرات"). Additive only.
-- A duty: a place (named by the admin), the wards it covers, the resident who holds its opioids.
-- Each holder's time with a duty is a tenure (a holder sees only the records of their own tenures).
-- Moves: ampoules issued (first issue / replenishment), used on a patient, or withdrawn by the admin;
-- what is left of an item = issued - used - withdrawn (voided uses do not count).
CREATE TABLE IF NOT EXISTS opioid_duties (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  hosp        TEXT    NOT NULL,
  place       TEXT    NOT NULL,
  wards       TEXT    NOT NULL DEFAULT '[]',
  status      TEXT    NOT NULL DEFAULT 'draft',   -- draft | active | deleted
  next_res    TEXT,                               -- the assigned holder (applied by "confirm and notify")
  next_key    TEXT,
  next_name   TEXT,
  created_by  TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);
CREATE INDEX IF NOT EXISTS opioid_duties_hosp ON opioid_duties (hosp, status);

CREATE TABLE IF NOT EXISTS opioid_tenures (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  duty_id     INTEGER NOT NULL,
  holder_res  TEXT,
  holder_key  TEXT    NOT NULL,
  holder_name TEXT    NOT NULL,
  started_at  INTEGER NOT NULL,
  started_by  TEXT,
  ended_at    INTEGER
);
CREATE INDEX IF NOT EXISTS opioid_tenures_duty ON opioid_tenures (duty_id, ended_at);
CREATE INDEX IF NOT EXISTS opioid_tenures_holder ON opioid_tenures (holder_key);

CREATE TABLE IF NOT EXISTS opioid_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  duty_id     INTEGER NOT NULL,
  name        TEXT    NOT NULL,
  low_at      INTEGER NOT NULL DEFAULT 2,          -- "running low" at this many or fewer
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS opioid_items_duty ON opioid_items (duty_id);

CREATE TABLE IF NOT EXISTS opioid_moves (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  duty_id     INTEGER NOT NULL,
  item_id     INTEGER NOT NULL,
  tenure_id   INTEGER,                            -- NULL: issued before the first confirmation
  kind        TEXT    NOT NULL,                   -- issue | use | withdraw | handover
  qty         INTEGER NOT NULL,
  patient     TEXT,
  sex         TEXT,                               -- m | f
  age         INTEGER,
  ward        TEXT,
  use_date    TEXT,                               -- YYYY-MM-DD
  note        TEXT,
  by_id       TEXT,
  by_name     TEXT,
  by_role     TEXT,
  created_at  INTEGER NOT NULL,
  voided_at   INTEGER,
  voided_by   TEXT,
  void_reason TEXT
);
CREATE INDEX IF NOT EXISTS opioid_moves_duty ON opioid_moves (duty_id, created_at);
CREATE INDEX IF NOT EXISTS opioid_moves_tenure ON opioid_moves (tenure_id);
CREATE INDEX IF NOT EXISTS opioid_moves_item ON opioid_moves (item_id);
