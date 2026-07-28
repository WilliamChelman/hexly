CREATE TABLE `compendiums` (
	`id` text PRIMARY KEY NOT NULL,
	`importer` text NOT NULL,
	`rev` text NOT NULL,
	`publisher` text,
	`license` text,
	`notice` text,
	FOREIGN KEY (`id`) REFERENCES `containers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `compendiums_importer_unique` ON `compendiums` (`importer`);