-- Fold entity_owners into entity_grants as role 'owner' (ADR-0037 revisited): entity
-- ownership stops being its own table and becomes the top role in the entity ACE set,
-- mirroring world_members. The DROP below is drizzle-kit's; the backfill above is
-- hand-added — drizzle-kit sees only the dropped table, not the data move. Owner wins the
-- merge: a user who was both an Owner and held an editor/viewer grant collapses to a single
-- 'owner' row (the ON CONFLICT upgrade). The `WHERE true` disambiguates the SELECT source
-- from the upsert's ON CONFLICT (SQLite quirk).
INSERT INTO `entity_grants` (`entity_id`, `user_id`, `role`)
SELECT `entity_id`, `user_id`, 'owner' FROM `entity_owners`
WHERE true
ON CONFLICT(`entity_id`, `user_id`) DO UPDATE SET `role` = 'owner';--> statement-breakpoint
DROP TABLE `entity_owners`;
