ALTER TABLE `world_types` DROP COLUMN `fields`;--> statement-breakpoint
ALTER TABLE `world_types` ADD `field_refs` text DEFAULT '[]' NOT NULL;