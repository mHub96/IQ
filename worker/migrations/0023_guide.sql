-- The Basra clinics guide (دليل البصرة الطبي) shown on the Specialists page (guide.js, hub-guide.js).
-- One row per guide: the whole catalogue as JSON, built by tools/guide/pdf_to_guide.py and uploaded
-- by the owner. Reading it costs one row. Additive only.

CREATE TABLE IF NOT EXISTS guide (
  id          TEXT PRIMARY KEY,       -- 'basra'
  v           INTEGER NOT NULL,       -- version (upload time, ms); the page keeps its copy until it changes
  data        TEXT NOT NULL,          -- { title, edition, author, org, contact, notes, cats, secs, items }
  updated_at  INTEGER NOT NULL,
  updated_by  TEXT
);
