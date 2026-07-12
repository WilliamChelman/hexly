-- Core type flip (ADR-0048): the single `type` text column becomes the multi-valued `types` JSON
-- array (mirroring `tags`), and the stored `document` body drops its `type` discriminator so it is
-- discriminated by Payload Kind composition instead. `note` → ['core.note'], `hexmap` →
-- ['core.hexmap']. The body reshape is a pure key removal (`json_remove($.type)`) SQL can do in
-- place, so no boot backfill is needed.
--
-- ADD/DROP COLUMN, never a table rebuild: the FTS5 external-content index (migration 0002) is keyed
-- by `entities.rowid`, and ADD/DROP COLUMN preserves every rowid where a rebuild would renumber them
-- and desync the index (the same reason migration 0011 avoided a rebuild). The FTS triggers index
-- only name/tags/content_text — none of the columns this migration touches — so their WHEN clauses
-- stay false and no trigger surgery is required.
--
-- The added column carries `DEFAULT '[]'` so `ADD COLUMN … NOT NULL` is legal against existing rows;
-- the very next statement overwrites every row with its real type set, and all runtime inserts supply
-- `types` explicitly, so the default is never the stored value.
ALTER TABLE `entities` ADD `types` text NOT NULL DEFAULT '[]';--> statement-breakpoint
UPDATE `entities` SET `types` = json_array('core.' || `type`);--> statement-breakpoint
UPDATE `entities` SET `document` = json_remove(`document`, '$.type');--> statement-breakpoint
ALTER TABLE `entities` DROP COLUMN `type`;
