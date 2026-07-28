-- The authored vocabulary belongs to a Container, not a World (ADR-0078, #397). Hand-edited from
-- drizzle-kit's output, as 0033 was. A rename, not a rewrite: a World's Container id *is* the World's
-- id, so not one stored value moves — every user-defined Type and Field stays in exactly the Container
-- it was already in, and every stored `world.`-namespaced id keeps resolving.
--
-- Both tables are rebuilt rather than renamed in place, because each carries a real foreign key and a
-- composite primary key spanning the renamed column, and SQLite can alter neither: the rebuild is what
-- moves the key to `containers` and re-heads the PK on `container_id`. drizzle emits the copy reading
-- `container_id` from the pre-rename table; it is corrected to read `world_id`, which is where the
-- values still are at this point.
--
-- The cascade *source* moves with the foreign key: a row used to die with the `worlds` satellite and now
-- dies with the `containers` row. For a World that is the same event — 0032 already cascades `worlds`
-- off `containers`, and deleting a World deletes its Container — so an Owner deleting a World still
-- takes its Types and Fields with it.
--
-- drizzle's `PRAGMA foreign_keys` pair is dropped, as 0032 and 0033 dropped it: the pragma is a no-op
-- inside drizzle's transaction and createDb owns it for the whole migration window (ADR-0027).
CREATE TABLE `__new_world_types` (
	`container_id` text NOT NULL,
	`type_id` text NOT NULL,
	`label` text NOT NULL,
	`field_refs` text DEFAULT '[]' NOT NULL,
	`views` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`container_id`, `type_id`),
	FOREIGN KEY (`container_id`) REFERENCES `containers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_world_types`("container_id", "type_id", "label", "field_refs", "views", "created_at", "updated_at") SELECT "world_id", "type_id", "label", "field_refs", "views", "created_at", "updated_at" FROM `world_types`;--> statement-breakpoint
DROP TABLE `world_types`;--> statement-breakpoint
ALTER TABLE `__new_world_types` RENAME TO `world_types`;--> statement-breakpoint
CREATE TABLE `__new_world_fields` (
	`container_id` text NOT NULL,
	`field_id` text NOT NULL,
	`definition` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`container_id`, `field_id`),
	FOREIGN KEY (`container_id`) REFERENCES `containers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_world_fields`("container_id", "field_id", "definition", "created_at", "updated_at") SELECT "world_id", "field_id", "definition", "created_at", "updated_at" FROM `world_fields`;--> statement-breakpoint
DROP TABLE `world_fields`;--> statement-breakpoint
ALTER TABLE `__new_world_fields` RENAME TO `world_fields`;
