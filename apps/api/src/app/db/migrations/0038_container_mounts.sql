CREATE TABLE `container_mounts` (
	`container_id` text NOT NULL,
	`mounted_container_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`container_id`, `mounted_container_id`),
	FOREIGN KEY (`container_id`) REFERENCES `containers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mounted_container_id`) REFERENCES `containers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_container_mounts_mounted` ON `container_mounts` (`mounted_container_id`);