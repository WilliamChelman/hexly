ALTER TABLE `entities` ADD `content_text` text;--> statement-breakpoint
-- Full-text search (ADR-0035). Hand-authored below this line: drizzle-kit won't
-- emit FTS5 DDL. External-content table (content='entities', content_rowid='rowid')
-- so FTS stores no duplicate copy; kept in sync by triggers, not app upserts (one
-- extractText owns content_text, every write path indexes automatically). Guarded
-- like this so re-running is harmless (the migrate ledger already skips applied files).
CREATE VIRTUAL TABLE IF NOT EXISTS `entities_fts` USING fts5(
  name, tags, content_text,
  content='entities', content_rowid='rowid'
);--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `entities_fts_ai` AFTER INSERT ON `entities` BEGIN
  INSERT INTO entities_fts(rowid, name, tags, content_text)
  VALUES (new.rowid, new.name, new.tags, new.content_text);
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `entities_fts_ad` AFTER DELETE ON `entities` BEGIN
  INSERT INTO entities_fts(entities_fts, rowid, name, tags, content_text)
  VALUES ('delete', old.rowid, old.name, old.tags, old.content_text);
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `entities_fts_au` AFTER UPDATE ON `entities`
WHEN old.name IS NOT new.name OR old.tags IS NOT new.tags OR old.content_text IS NOT new.content_text BEGIN
  INSERT INTO entities_fts(entities_fts, rowid, name, tags, content_text)
  VALUES ('delete', old.rowid, old.name, old.tags, old.content_text);
  INSERT INTO entities_fts(rowid, name, tags, content_text)
  VALUES (new.rowid, new.name, new.tags, new.content_text);
END;
