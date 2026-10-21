-- Duty reminders ("My Schedule" switch): a notification a chosen time before the resident's next
-- duty. See worker/src/reminders.js. Additive only: new tables.

-- One row per account that switched reminders on.
CREATE TABLE IF NOT EXISTS duty_reminders (
  account_id TEXT    PRIMARY KEY,
  lead_min   INTEGER NOT NULL,          -- minutes before the duty starts
  names      TEXT,                      -- hospital duty codes -> names, as the resident's app shows them
  synced_at  INTEGER NOT NULL DEFAULT 0, -- last time the queue below was rebuilt from the schedules
  updated_at INTEGER NOT NULL
);

-- The coming reminders of each account (rebuilt from the schedules; sent and removed by the cron).
CREATE TABLE IF NOT EXISTS duty_reminder_queue (
  account_id TEXT    NOT NULL,
  dkey       TEXT    NOT NULL,          -- the duty's key (as in My Schedule)
  fire_at    INTEGER NOT NULL,          -- when to notify (ms)
  start_at   INTEGER NOT NULL,          -- when the duty starts (ms)
  title      TEXT    NOT NULL,
  hosp       TEXT,
  sent       INTEGER NOT NULL DEFAULT 0, -- 1 once notified (cleared if the duty's time changes)
  PRIMARY KEY (account_id, dkey)
);
CREATE INDEX IF NOT EXISTS idx_duty_reminder_fire ON duty_reminder_queue (fire_at);
