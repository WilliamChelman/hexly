CREATE TABLE `entity_links` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_entity_links_entity_id` ON `entity_links` (`entity_id`);