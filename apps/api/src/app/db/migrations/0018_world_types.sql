CREATE TABLE `world_types` (
	`world_id` text NOT NULL,
	`type_id` text NOT NULL,
	`label` text NOT NULL,
	`fields` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`world_id`, `type_id`),
	FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON UPDATE no action ON DELETE cascade
);
