CREATE TABLE `entities` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`world_id` text NOT NULL,
	`is_home` integer DEFAULT false NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`tags` text NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`version` integer NOT NULL,
	`document` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_entities_owner_id` ON `entities` (`owner_id`);--> statement-breakpoint
CREATE INDEX `idx_entities_world_id` ON `entities` (`world_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_world_home` ON `entities` (`world_id`) WHERE "entities"."is_home" = 1;--> statement-breakpoint
CREATE TABLE `entity_descriptors` (
	`entity_id` text NOT NULL,
	`descriptor` text NOT NULL,
	PRIMARY KEY(`entity_id`, `descriptor`),
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_expires_at` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `world_links` (
	`id` text PRIMARY KEY NOT NULL,
	`world_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_world_links_world_id` ON `world_links` (`world_id`);--> statement-breakpoint
CREATE TABLE `world_members` (
	`world_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`world_id`, `user_id`),
	FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `worlds` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_worlds_owner_id` ON `worlds` (`owner_id`);