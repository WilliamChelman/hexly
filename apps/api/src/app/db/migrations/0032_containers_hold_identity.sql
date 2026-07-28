-- Containers hold identity; worlds becomes a satellite (ADR-0078, #395). Hand-edited from
-- drizzle-kit's output to slot the backfill between the two halves: the `INSERT ... SELECT` must
-- read `name`, `seq`, `created_at` and `updated_at` *before* the rebuild drops them off `worlds`.
--
-- This is a backfill, not a rewrite. `worlds.id` stays the primary key and *is* the container id,
-- so every existing World gets a `containers` row at the same id — no World id moves, no URL
-- breaks, and no `entities.world_id` value is touched. Foreign keys are OFF for the whole
-- migration window (createDb), so the implicit DELETE on `DROP TABLE worlds` never cascades into
-- world_members / world_types / world_fields / world_links.
CREATE TABLE `containers` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`seq` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
-- Every World that exists is a Container of kind `world`, at its own id and carrying its own
-- freshness key — a live-follower's held `seq` stays comparable across the upgrade.
INSERT INTO `containers` (`id`, `kind`, `name`, `seq`, `created_at`, `updated_at`)
  SELECT `id`, 'world', `name`, `seq`, `created_at`, `updated_at` FROM `worlds`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_worlds` (
	`id` text PRIMARY KEY NOT NULL,
	`pinned_entity_ids` text DEFAULT '[]' NOT NULL,
	`theme` text,
	FOREIGN KEY (`id`) REFERENCES `containers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_worlds`("id", "pinned_entity_ids", "theme") SELECT "id", "pinned_entity_ids", "theme" FROM `worlds`;--> statement-breakpoint
DROP TABLE `worlds`;--> statement-breakpoint
ALTER TABLE `__new_worlds` RENAME TO `worlds`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
