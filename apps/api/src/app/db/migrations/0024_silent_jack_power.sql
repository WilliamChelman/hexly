CREATE TABLE `entity_import_source` (
	`entity_id` text PRIMARY KEY NOT NULL,
	`world_id` text NOT NULL,
	`importer` text NOT NULL,
	`source_id` text NOT NULL,
	`rev` text NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_entity_import_source_world_importer` ON `entity_import_source` (`world_id`,`importer`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_entity_import_source_upsert` ON `entity_import_source` (`world_id`,`importer`,`source_id`);