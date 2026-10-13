-- Personal accounts, notifications, likes and comments.
-- Purely additive: the live Worker never reads these tables, so applying this to the shared
-- database cannot affect the live site.

-- One row per person. Passwords never reach the server in clear: the browser derives a key with
-- PBKDF2 (see hub-accounts.js) and the server stores SHA-256(salt || key).
CREATE TABLE IF NOT EXISTS accounts (
  id          TEXT PRIMARY KEY,
  username    TEXT NOT NULL UNIQUE,          -- lower case
  pw          TEXT NOT NULL,
  salt        TEXT NOT NULL,
  name        TEXT NOT NULL,                 -- the matched resident's name as stored in the roster
  name_key    TEXT NOT NULL,                 -- normalised name, links duty cards to the account
  phone       TEXT NOT NULL,                 -- normalised (7XXXXXXXXX)
  hosp        TEXT NOT NULL,                 -- hospital chosen at sign-up
  resident_id TEXT,
  role        TEXT NOT NULL DEFAULT 'user',  -- user | anaesthesia | admin | owner
  hospitals   TEXT NOT NULL DEFAULT '[]',    -- scope of admin / anaesthesia rights
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | active | rejected | disabled
  sess        INTEGER NOT NULL DEFAULT 1,    -- bumped to sign the account out everywhere
  reset       TEXT,                          -- NULL | requested | approved
  reset_at    INTEGER,
  created_at  INTEGER NOT NULL,
  decided_at  INTEGER,
  decided_by  TEXT,
  last_seen   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts (status, hosp);
CREATE INDEX IF NOT EXISTS idx_accounts_name_key ON accounts (name_key);
CREATE INDEX IF NOT EXISTS idx_accounts_reset ON accounts (reset);
-- A resident can only have one live account (a rejected request does not block a new one).
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_resident ON accounts (resident_id) WHERE status IN ('pending', 'active');

-- Notifications are grouped: one row per (account, gkey), e.g. all likes on one duty card.
CREATE TABLE IF NOT EXISTS notifications (
  nid        INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT    NOT NULL,
  gkey       TEXT    NOT NULL,
  type       TEXT    NOT NULL,
  data       TEXT    NOT NULL,
  ts         INTEGER NOT NULL,
  seen       INTEGER NOT NULL DEFAULT 0,
  UNIQUE (account_id, gkey)
);
CREATE INDEX IF NOT EXISTS idx_notifications_account ON notifications (account_id, ts);

-- target = "duty:<hospital>:<YYYY-MM-DD>:<name_key>" (one resident's duty card on one day).
CREATE TABLE IF NOT EXISTS likes (
  target     TEXT NOT NULL,
  account_id TEXT NOT NULL,
  ts         INTEGER NOT NULL,
  PRIMARY KEY (target, account_id)
);

CREATE TABLE IF NOT EXISTS comments (
  cid        INTEGER PRIMARY KEY AUTOINCREMENT,
  target     TEXT    NOT NULL,
  hosp       TEXT    NOT NULL,
  account_id TEXT    NOT NULL,
  anon       TEXT,                           -- anonymous tag, NULL when signed with the real name
  body       TEXT    NOT NULL,
  ts         INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_comments_target ON comments (target, cid);
CREATE INDEX IF NOT EXISTS idx_comments_account ON comments (account_id, ts);

-- Generic fixed-window rate limiter (k = "<kind>:<ip or account>").
CREATE TABLE IF NOT EXISTS rate_limit (
  k      TEXT    NOT NULL,
  bucket INTEGER NOT NULL,
  n      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (k, bucket)
);
