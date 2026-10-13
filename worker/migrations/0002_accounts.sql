-- Personal accounts, devices, push subscriptions, notifications, likes and comments.
-- Purely additive: the live Worker never reads these tables, so applying this to the shared
-- database cannot affect the live site.

-- One row per person. Passwords never reach the server in clear: the browser derives a key with
-- PBKDF2 (see hub-core.js) and the server stores SHA-256(salt || key).
CREATE TABLE IF NOT EXISTS accounts (
  id          TEXT PRIMARY KEY,
  username    TEXT NOT NULL UNIQUE,          -- lower case
  pw          TEXT NOT NULL,
  salt        TEXT NOT NULL,
  name        TEXT NOT NULL,                 -- the matched resident's name as stored in the roster
  name_key    TEXT NOT NULL,                 -- normalised name, links duty cards to the account
  phone       TEXT NOT NULL,                 -- normalised (7XXXXXXXXX)
  sex         TEXT NOT NULL CHECK (sex IN ('m', 'f')),
  hosp        TEXT NOT NULL,                 -- hospital chosen at sign-up
  resident_id TEXT,
  role        TEXT NOT NULL DEFAULT 'user',  -- user | anaesthesia | admin | owner
  hospitals   TEXT NOT NULL DEFAULT '[]',    -- scope of admin / anaesthesia rights
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | active | rejected | disabled
  sess        INTEGER NOT NULL DEFAULT 1,    -- bumped to sign the account out everywhere
  max_devices INTEGER NOT NULL DEFAULT 0,    -- 0 = unlimited
  anon_tag    TEXT NOT NULL,                 -- Reddit-style nickname used for anonymous comments
  anon_key    TEXT NOT NULL UNIQUE,          -- normalised anon_tag (duplicate check)
  anon_lang   TEXT NOT NULL DEFAULT 'ar',    -- ar | en
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

-- Devices an account has signed in on (enforces the device limit; removing one signs it out).
CREATE TABLE IF NOT EXISTS account_devices (
  account_id TEXT NOT NULL,
  device_id  TEXT NOT NULL,
  label      TEXT,
  first_seen INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  PRIMARY KEY (account_id, device_id)
);

-- Web Push subscriptions (one per browser).
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint   TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  device_id  TEXT,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_account ON push_subs (account_id);

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
  anon       INTEGER NOT NULL DEFAULT 0,     -- 1 = shown under the author's anonymous nickname
  body       TEXT    NOT NULL,
  ts         INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  deleted_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_comments_target ON comments (target, cid);
CREATE INDEX IF NOT EXISTS idx_comments_hosp ON comments (hosp, cid);
CREATE INDEX IF NOT EXISTS idx_comments_account ON comments (account_id, ts);

-- Generic fixed-window rate limiter (k = "<kind>:<ip or account>").
CREATE TABLE IF NOT EXISTS rate_limit (
  k      TEXT    NOT NULL,
  bucket INTEGER NOT NULL,
  n      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (k, bucket)
);
