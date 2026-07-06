-- Symmetric ownership sets (ADR-0037, #158). Hand-authored, replacing drizzle-kit's
-- naive column-drop: SQLite can't DROP a column a foreign key references (owner_id →
-- users), so both tables are rebuilt to shed the column and its FK. The backfill must
-- read owner_id *before* the rebuild drops it. Foreign keys are OFF for the whole
-- migration window (createDb), so the implicit DELETE on DROP TABLE never cascades into
-- entity_owners / entity_descriptors. The entities rebuild carries `rowid` forward so the
-- FTS external-content index (migration 0002, keyed by rowid) stays aligned — only its
-- triggers, dropped with the old table, are recreated below.
CREATE TABLE `entity_owners` (
	`entity_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`entity_id`, `user_id`),
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
-- Every prior single Owner becomes the sole member of its new ownership set.
INSERT INTO `entity_owners` (`entity_id`, `user_id`) SELECT `id`, `owner_id` FROM `entities`;--> statement-breakpoint
INSERT INTO `world_members` (`world_id`, `user_id`, `role`) SELECT `id`, `owner_id`, 'owner' FROM `worlds`;--> statement-breakpoint
-- Rebuild `entities` without owner_id / its FK, preserving rowid for the FTS index.
DROP TRIGGER IF EXISTS `entities_fts_ai`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `entities_fts_ad`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `entities_fts_au`;--> statement-breakpoint
CREATE TABLE `__new_entities` (
	`id` text PRIMARY KEY NOT NULL,
	`world_id` text NOT NULL,
	`is_home` integer DEFAULT false NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`tags` text NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`version` integer NOT NULL,
	`document` text NOT NULL,
	`content_text` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_entities`("rowid", "id", "world_id", "is_home", "name", "type", "tags", "visibility", "version", "document", "content_text", "created_at", "updated_at") SELECT "rowid", "id", "world_id", "is_home", "name", "type", "tags", "visibility", "version", "document", "content_text", "created_at", "updated_at" FROM `entities`;--> statement-breakpoint
DROP TABLE `entities`;--> statement-breakpoint
ALTER TABLE `__new_entities` RENAME TO `entities`;--> statement-breakpoint
CREATE INDEX `idx_entities_world_id` ON `entities` (`world_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_world_home` ON `entities` (`world_id`) WHERE "entities"."is_home" = 1;--> statement-breakpoint
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
-- Rebuild `worlds` without owner_id / its FK (its only index was on owner_id, now gone).
CREATE TABLE `__new_worlds` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_worlds`("id", "name", "created_at", "updated_at") SELECT "id", "name", "created_at", "updated_at" FROM `worlds`;--> statement-breakpoint
DROP TABLE `worlds`;--> statement-breakpoint
ALTER TABLE `__new_worlds` RENAME TO `worlds`;
