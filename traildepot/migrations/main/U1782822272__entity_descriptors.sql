-- Link Descriptor vocabulary on TrailBase (#132, ADR-0023). The retired NestJS server
-- harvested descriptors client-side and replaced a per-entity index inside the save
-- transaction. TrailBase has no middleware, so the harvested set rides the save as a JSON
-- column (like `tags`) and an AFTER UPDATE trigger replaces the index — the server still
-- never parses the opaque Content snapshot (ADR-0019), only the client-supplied list.
-- Append-only/forward-only per ADR-0032.

-- Harvested set, written by the client on each version-checked save. Defaults to '[]' so a
-- create (and the Home Entity the worlds trigger mints) carries an empty set.
ALTER TABLE entities ADD COLUMN descriptors TEXT NOT NULL DEFAULT '[]' CHECK(is_json(descriptors));

-- The `::` suggestion index: one row per (entity, descriptor). `world_id` is carried so the
-- picker can list just the World being worked (a label coined in one World isn't offered in
-- another). Read access is gated by joining back to the source Entity (config.textproto), so
-- a descriptor is suggested only to someone who can read the Entity it came from — the World's
-- shared vocabulary, never a private Entity's labels leaking to its members (ADR-0024).
-- Surrogate UUIDv7 PK + UNIQUE(entity_id, descriptor) because a Record API can't key off a
-- composite PK (spike, #126). ON DELETE CASCADE off entities prunes an Entity's vocabulary.
CREATE TABLE entity_descriptors (
  id         BLOB    PRIMARY KEY NOT NULL CHECK(is_uuid_v7(id)) DEFAULT (uuid_v7()),
  entity_id  BLOB    NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  world_id   BLOB    NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  descriptor TEXT    NOT NULL,
  UNIQUE(entity_id, descriptor)
) STRICT;

CREATE INDEX idx_entity_descriptors_world_id ON entity_descriptors (world_id);

-- Replace this Entity's index rows from the harvested set on each save (#132). The
-- self-pruning step: a descriptor the save no longer carries loses its row and stops being
-- suggested. Scoped to UPDATE OF descriptors, which the body save always carries — and only
-- an admitted save reaches here (a stale write is rejected by the version access-rule before
-- the row changes), so the index always reflects last-*successful*-save state. No INSERT
-- trigger: a create carries the empty default and only a save (an UPDATE) ever sets descriptors.
CREATE TRIGGER entities_after_update_descriptors AFTER UPDATE OF descriptors ON entities
FOR EACH ROW
BEGIN
  DELETE FROM entity_descriptors WHERE entity_id = NEW.id;
  INSERT INTO entity_descriptors (entity_id, world_id, descriptor)
  SELECT NEW.id, NEW.world_id, value FROM json_each(NEW.descriptors);
END;
