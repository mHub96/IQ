-- Website statistics: one snapshot a night per hospital (scope = hospital id) and for the whole site
-- (scope = '*'): active users of the day, week and month, accounts, interactions. Past activity that
-- leaves no trace (who was active on a given day) is only known from these snapshots on.
CREATE TABLE IF NOT EXISTS stats_daily (
  day   TEXT NOT NULL,   -- YYYY-MM-DD, Iraq time
  scope TEXT NOT NULL,   -- hospital id or '*'
  data  TEXT NOT NULL,   -- JSON
  PRIMARY KEY (day, scope)
);
