CREATE TABLE `entity_field_facets` (
	`entity_id` text NOT NULL,
	`world_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`num` real,
	PRIMARY KEY(`entity_id`, `key`, `value`),
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_entity_field_facets_key` ON `entity_field_facets` (`world_id`,`key`,`value`);