-- Replies: a comment can answer another comment on the same duty card (one level, like Instagram).
ALTER TABLE comments ADD COLUMN parent_cid INTEGER;
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments (parent_cid);
