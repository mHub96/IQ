-- One contact visit per person per resident per minute (Call and WhatsApp count as the same visit).
-- k = "<account / device / ip>|<hospital>|<resident name key>|<duty day>", ts = last counted visit (ms).
CREATE TABLE IF NOT EXISTS visit_cooldown (
  k  TEXT PRIMARY KEY,
  ts INTEGER NOT NULL
);
