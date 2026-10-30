-- Additive only.

-- My Schedule: duties a resident adds to their own calendar (an ER position, a duty of one of their
-- specialties, or one they name, all day or between two times). Kept in duty_marks (dkey
-- "<YYYY-MM-DD>|c|<id>") so the month's marks query returns them with no extra read; the row's
-- marks (bought / sold, flag, note) work as for any other duty.
ALTER TABLE duty_marks ADD COLUMN custom TEXT;

-- ER preferences history: one entry per resident (id in the ER residents database) per month.
-- prefs/note: what was asked for that month (preferences portal or the ER page's panel), the last
-- save winning; imported: the answers sent on the old Google Form (JSON), kept apart.
CREATE TABLE IF NOT EXISTS er_pref_history (
  hosp       TEXT    NOT NULL,
  er_id      TEXT    NOT NULL,
  ym         TEXT    NOT NULL,  -- YYYY-MM
  er_name    TEXT,
  prefs      TEXT,              -- JSON (same fields as er_pref_requests.prefs) or NULL
  note       TEXT,
  source     TEXT,              -- portal | er | import
  updated_at INTEGER NOT NULL,
  imported   TEXT,
  PRIMARY KEY (hosp, er_id, ym)
);
