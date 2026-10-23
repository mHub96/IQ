-- On-call status of a duty card (surgical branches: in the theatre, away for a consultation, custom)
-- and the contact requests left for a busy resident. Additive only.

CREATE TABLE IF NOT EXISTS duty_status (
  target TEXT PRIMARY KEY,          -- the card: duty:<hospital>:<YYYY-MM-DD>:<name key>
  hosp TEXT NOT NULL,
  card_date TEXT NOT NULL,          -- YYYY-MM-DD (the duty day, 08:00 to 08:00 Iraq time)
  account_id TEXT NOT NULL,         -- who set it (the duty holder)
  status TEXT NOT NULL,             -- 'or' | 'consult' | 'custom'
  skin TEXT,
  label TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_duty_status_day ON duty_status (hosp, card_date);

CREATE TABLE IF NOT EXISTS contact_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target TEXT NOT NULL,             -- the card, as above
  hosp TEXT NOT NULL,
  card_date TEXT NOT NULL,
  card_name TEXT,
  holder_key TEXT NOT NULL,         -- name key of the duty holder (their accounts see the request)
  requester_id TEXT NOT NULL,
  requester_name TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'done' | 'missed' | 'cancelled'
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contact_requests_holder ON contact_requests (holder_key, status);
CREATE INDEX IF NOT EXISTS idx_contact_requests_target ON contact_requests (target, status);
CREATE INDEX IF NOT EXISTS idx_contact_requests_requester ON contact_requests (requester_id, created_at);
