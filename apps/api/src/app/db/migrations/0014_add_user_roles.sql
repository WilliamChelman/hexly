ALTER TABLE `users` ADD `roles` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
UPDATE `users` SET `roles` =
  CASE
    WHEN `is_admin` = 1 AND `can_create_worlds` = 1 THEN '["manage-users","create-worlds"]'
    WHEN `is_admin` = 1 THEN '["manage-users"]'
    WHEN `can_create_worlds` = 1 THEN '["create-worlds"]'
    ELSE '[]'
  END;