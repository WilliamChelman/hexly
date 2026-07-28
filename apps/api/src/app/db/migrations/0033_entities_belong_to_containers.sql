-- The entity side names a Container, not a World (ADR-0078, #396). Hand-edited from drizzle-kit's
-- output. A rename, not a rewrite: a World's Container id *is* the World's id, so not one stored
-- value moves — every Entity, edge, facet, Import Source and Asset stays in exactly the Container it
-- was already in, and every Asset's `<containerId>/<hash><ext>` byte address resolves unchanged.
--
-- `entities` alone is rebuilt, because its foreign key moves from `worlds` to `containers` and SQLite
-- has no way to alter one in place. The rebuild carries `rowid` forward so the external-content FTS
-- index (migration 0002, keyed by rowid) stays aligned, and recreates the three sync triggers that go
-- with the dropped table — 0003's precedent. drizzle's `PRAGMA foreign_keys` pair is dropped, as 0032
-- dropped it: the pragma is a no-op inside drizzle's transaction and createDb owns it for the whole
-- migration window (ADR-0027), which is what keeps `DROP TABLE entities` from cascading the grants,
-- edges, facets and index rows hanging off it away.
DROP TRIGGER IF EXISTS `entities_fts_ai`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `entities_fts_ad`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `entities_fts_au`;--> statement-breakpoint
CREATE TABLE `__new_entities` (
	`id` text PRIMARY KEY NOT NULL,
	`container_id` text NOT NULL,
	`name` text NOT NULL,
	`types` text NOT NULL,
	`tags` text NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`version` integer NOT NULL,
	`seq` integer DEFAULT 1 NOT NULL,
	`document` text NOT NULL,
	`content_text` text,
	`thumbnail_entity_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`container_id`) REFERENCES `containers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_entities`("rowid", "id", "container_id", "name", "types", "tags", "visibility", "version", "seq", "document", "content_text", "thumbnail_entity_id", "created_at", "updated_at") SELECT "rowid", "id", "world_id", "name", "types", "tags", "visibility", "version", "seq", "document", "content_text", "thumbnail_entity_id", "created_at", "updated_at" FROM `entities`;--> statement-breakpoint
DROP TABLE `entities`;--> statement-breakpoint
ALTER TABLE `__new_entities` RENAME TO `entities`;--> statement-breakpoint
CREATE INDEX `idx_entities_container_id` ON `entities` (`container_id`);--> statement-breakpoint
-- Recreate the FTS sync triggers (migration 0002), dropped with the old table.
CREATE TRIGGER `entities_fts_ai` AFTER INSERT ON `entities` BEGIN
  INSERT INTO entities_fts(rowid, name, tags, content_text)
  VALUES (new.rowid, new.name, new.tags, new.content_text);
END;--> statement-breakpoint
CREATE TRIGGER `entities_fts_ad` AFTER DELETE ON `entities` BEGIN
  INSERT INTO entities_fts(entities_fts, rowid, name, tags, content_text)
  VALUES ('delete', old.rowid, old.name, old.tags, old.content_text);
END;--> statement-breakpoint
CREATE TRIGGER `entities_fts_au` AFTER UPDATE ON `entities`
WHEN old.name IS NOT new.name OR old.tags IS NOT new.tags OR old.content_text IS NOT new.content_text BEGIN
  INSERT INTO entities_fts(entities_fts, rowid, name, tags, content_text)
  VALUES ('delete', old.rowid, old.name, old.tags, old.content_text);
  INSERT INTO entities_fts(rowid, name, tags, content_text)
  VALUES (new.rowid, new.name, new.tags, new.content_text);
END;--> statement-breakpoint
-- The four derived indexes carry no foreign key, so each is a true in-place column rename: not a row is
-- copied, and SQLite rewrites the column inside every index spanning it — the unique
-- `idx_asset_index_dedup` included, which is why an upload of already-stored bytes still dedups to the
-- Asset wrapping them. Only the two index *names* that said World are restated.
ALTER TABLE `asset_index` RENAME COLUMN "world_id" TO "container_id";--> statement-breakpoint
ALTER TABLE `entity_field_facets` RENAME COLUMN "world_id" TO "container_id";--> statement-breakpoint
ALTER TABLE `entity_edges` RENAME COLUMN "world_id" TO "container_id";--> statement-breakpoint
DROP INDEX `idx_entity_edges_world`;--> statement-breakpoint
CREATE INDEX `idx_entity_edges_container` ON `entity_edges` (`container_id`,`target_kind`);--> statement-breakpoint
ALTER TABLE `entity_import_source` RENAME COLUMN "world_id" TO "container_id";--> statement-breakpoint
DROP INDEX `idx_entity_import_source_world_importer`;--> statement-breakpoint
CREATE INDEX `idx_entity_import_source_container_importer` ON `entity_import_source` (`container_id`,`importer`);
