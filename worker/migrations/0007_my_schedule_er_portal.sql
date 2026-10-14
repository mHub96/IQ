-- "My Schedule" personal duty marks and the ER preferences portal.
-- Additive only: new beta-only tables; the live Worker never reads them.

-- A resident's own notes on one of their duties: bought (+$) / sold (-$), a flag with a reason,
-- and a free note. dkey = "<YYYY-MM-DD>|<source>|<slot>", e.g. "2026-10-14|er|morning" or
-- "2026-10-14|h|NS:0" (hospital roster: specialty code and slot).
CREATE TABLE IF NOT EXISTS duty_marks (
  account_id TEXT    NOT NULL,
  dkey       TEXT    NOT NULL,
  kind       TEXT,              -- bought | sold | NULL
  flag       TEXT,              -- flag id (see duties.js FLAGS) or NULL
  flag_text  TEXT,              -- the resident's reason for the flag
  note       TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, dkey)
);

-- An admin opens the portal for one hospital and one month until closes_at.
CREATE TABLE IF NOT EXISTS er_portals (
  hosp       TEXT    NOT NULL,
  ym         TEXT    NOT NULL,  -- YYYY-MM of the schedule the preferences are for
  opens_at   INTEGER NOT NULL,
  closes_at  INTEGER NOT NULL,
  opened_by  TEXT,
  closed_at  INTEGER,           -- set when an admin ends it early
  PRIMARY KEY (hosp, ym)
);

-- One preferences request per resident account per portal. The ER page copies a request into
-- the ER residents database (and stamps applied_at) when an admin opens that month.
CREATE TABLE IF NOT EXISTS er_pref_requests (
  hosp       TEXT    NOT NULL,
  ym         TEXT    NOT NULL,
  account_id TEXT    NOT NULL,
  er_id      TEXT,              -- the resident's id in the ER residents database
  er_name    TEXT,
  name       TEXT,              -- account name at the time of the request
  prefs      TEXT    NOT NULL,  -- JSON, same fields the ER preferences panel saves
  updated_at INTEGER NOT NULL,
  applied_at INTEGER,
  PRIMARY KEY (hosp, ym, account_id)
);
CREATE INDEX IF NOT EXISTS idx_er_pref_requests_portal ON er_pref_requests (hosp, ym, updated_at);
