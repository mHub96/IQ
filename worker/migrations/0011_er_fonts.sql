-- Fonts uploaded on the ER page for its printed sheets (shared by everyone who prints there; kept
-- until deleted). See worker/src/erfonts.js. Additive only: a new table the live Worker never reads.

CREATE TABLE IF NOT EXISTS er_fonts (
  id         TEXT    PRIMARY KEY,      -- random, also the file's public address
  name       TEXT    NOT NULL,         -- shown in the font list
  file_name  TEXT    NOT NULL,
  format     TEXT    NOT NULL,         -- truetype | opentype | woff | woff2
  size       INTEGER NOT NULL,
  data       TEXT    NOT NULL,         -- the file in base64 (the browser decodes it)
  created_by TEXT,
  created_at INTEGER NOT NULL
);
