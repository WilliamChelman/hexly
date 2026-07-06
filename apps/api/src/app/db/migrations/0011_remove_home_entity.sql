-- Remove the Home Entity (ADR-0043, #166). The `is_home` flag and its `idx_world_home` partial
-- unique index go; an existing home note survives as an ordinary Note purely as a side effect
-- (pre-launch, no demotion or content-preservation logic). `DROP COLUMN` (not a table rebuild)
-- keeps every entities rowid, so the external-content FTS index (migration 0002) stays aligned
-- without recreating its triggers — those never referenced is_home. `pinned_entity_ids` is the
-- Owner-curated Dashboard pin set (ordered JSON array), added here so the schema change is one
-- atomic unit the later World Dashboard slices consume.
DROP INDEX `idx_world_home`;--> statement-breakpoint
ALTER TABLE `entities` DROP COLUMN `is_home`;--> statement-breakpoint
ALTER TABLE `worlds` ADD `pinned_entity_ids` text DEFAULT '[]' NOT NULL;
