CREATE TABLE `asset_index` (
	`entity_id` text PRIMARY KEY NOT NULL,
	`world_id` text NOT NULL,
	`hash` text NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_asset_index_dedup` ON `asset_index` (`world_id`,`hash`);--> statement-breakpoint
DROP TABLE `assets`;