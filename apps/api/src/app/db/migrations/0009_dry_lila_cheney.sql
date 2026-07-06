ALTER TABLE `users` ADD `is_admin` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `is_superadmin` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `disabled_at` integer;