CREATE TABLE `assets` (
	`hash` text NOT NULL,
	`world_id` text NOT NULL,
	`original_filename` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`world_id`, `hash`),
	FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON UPDATE no action ON DELETE cascade
);
