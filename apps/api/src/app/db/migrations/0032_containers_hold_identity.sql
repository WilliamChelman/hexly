-- Containers hold identity; worlds becomes a satellite (ADR-0078, #395). Hand-edited from
-- drizzle-kit's output, as 0003 was: the backfill must read `name`, `seq`, `created_at` and
-- `updated_at` *before* the rebuild drops them, and drizzle's `PRAGMA foreign_keys` boilerplate is
-- dropped because createDb owns that pragma for the whole migration window (ADR-0027) — so the
-- implicit DELETE on `DROP TABLE worlds` never cascades into the tables hanging off it.
CREATE TABLE `containers` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`seq` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
-- A backfill, not a rewrite: each World's Container lands at the World's own id, carrying its own
-- `seq` so a live-follower's held freshness stays comparable across the upgrade.
INSERT INTO `containers` (`id`, `kind`, `name`, `seq`, `created_at`, `updated_at`)
  SELECT `id`, 'world', `name`, `seq`, `created_at`, `updated_at` FROM `worlds`;--> statement-breakpoint
CREATE TABLE `__new_worlds` (
	`id` text PRIMARY KEY NOT NULL,
	`pinned_entity_ids` text DEFAULT '[]' NOT NULL,
	`theme` text,
	FOREIGN KEY (`id`) REFERENCES `containers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_worlds`("id", "pinned_entity_ids", "theme") SELECT "id", "pinned_entity_ids", "theme" FROM `worlds`;--> statement-breakpoint
DROP TABLE `worlds`;--> statement-breakpoint
ALTER TABLE `__new_worlds` RENAME TO `worlds`;
