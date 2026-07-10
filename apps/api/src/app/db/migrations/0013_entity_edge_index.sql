-- The derived Entity Link index (ADR-0046): one row per distinct
-- `(source_entity_id, target_kind, target_id, descriptor)` an Entity's document expresses,
-- harvested at the `EntityWrites` choke point and wholesale-replaced on every save.
--
-- `target_id` carries no FK and no unique constraint: targets are dangling-allowed (a link to a
-- missing or `private` Entity is a valid document), and the grain is enforced by the harvest, which
-- deduplicates before the INSERT. `descriptor` is nullable, so a UNIQUE over it would treat NULLs
-- as distinct in SQLite anyway.
--
-- This migration creates the table EMPTY and backfills nothing — a document's edges can only be
-- recovered by parsing its Content, which is not something SQL can do. An Entity that existed
-- before this migration therefore contributes no edge until it is next saved, or until a Superadmin
-- runs Reindex (#180), which re-runs the same derivation over every document. On an Instance with
-- pre-existing Entities, shipping this migration without #180 means empty References panels until
-- each Entity happens to be re-saved. ADR-0046 accepts that deliberately: the index is a cache,
-- never a source of truth, and nothing is in production to migrate.
CREATE TABLE `entity_edges` (
	`source_entity_id` text NOT NULL,
	`world_id` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`descriptor` text,
	FOREIGN KEY (`source_entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_entity_edges_source` ON `entity_edges` (`source_entity_id`);--> statement-breakpoint
CREATE INDEX `idx_entity_edges_target` ON `entity_edges` (`target_kind`,`target_id`);--> statement-breakpoint
CREATE INDEX `idx_entity_edges_world` ON `entity_edges` (`world_id`,`target_kind`);