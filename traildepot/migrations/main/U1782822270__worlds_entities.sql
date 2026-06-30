-- Worlds + Entities backbone on TrailBase Record APIs (#129, ADR-0032, ADR-0024).
-- Mirrors the retired Drizzle schema; UUIDv7 BLOB PKs are TrailBase's Record-API
-- requirement. `document` is validated client-side by zod and backstopped server-side
-- by the `entity_body` jsonschema CHECK below (#130) — the named schema is generated
-- from `@hexly/domain` into config.textproto by `pnpm gen:schema`.

CREATE TABLE worlds (
  id         BLOB    PRIMARY KEY NOT NULL CHECK(is_uuid_v7(id)) DEFAULT (uuid_v7()),
  name       TEXT    NOT NULL,
  owner_id   BLOB    NOT NULL REFERENCES _user(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
) STRICT;

CREATE INDEX idx_worlds_owner_id ON worlds (owner_id);

CREATE TABLE entities (
  id         BLOB    PRIMARY KEY NOT NULL CHECK(is_uuid_v7(id)) DEFAULT (uuid_v7()),
  owner_id   BLOB    NOT NULL REFERENCES _user(id),
  world_id   BLOB    NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  is_home    INTEGER NOT NULL DEFAULT FALSE,
  name       TEXT    NOT NULL,
  type       TEXT    NOT NULL,
  tags       TEXT    NOT NULL DEFAULT '[]' CHECK(is_json(tags)),
  visibility TEXT    NOT NULL DEFAULT 'private',
  version    INTEGER NOT NULL DEFAULT 1,
  -- Server-side body backstop (#130, ADR-0032): a malformed Entity document is
  -- unwritable. The named schema is registered in config.textproto (gen:schema).
  document   TEXT    NOT NULL CHECK(jsonschema('entity_body', document)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
) STRICT;

CREATE INDEX idx_entities_owner_id ON entities (owner_id);
CREATE INDEX idx_entities_world_id ON entities (world_id);
-- At most one Home Entity per World (ADR-0024).
CREATE UNIQUE INDEX idx_world_home ON entities (world_id) WHERE is_home = TRUE;

-- Creating a World atomically mints its Home Entity (ADR-0024): a `note` titled
-- with the World name (ADR-0029), flagged is_home.
CREATE TRIGGER worlds_after_insert_home AFTER INSERT ON worlds
BEGIN
  INSERT INTO entities (owner_id, world_id, is_home, name, type, document)
  VALUES (
    NEW.owner_id, NEW.id, TRUE, NEW.name, 'note',
    '{"type":"note","content":{"format":"tiptap-v2","snapshot":{"type":"doc","content":[]}}}'
  );
END;

-- The World name is the source of truth for its Home Entity's title (ADR-0029):
-- a World rename follows through to the Home note.
CREATE TRIGGER worlds_after_rename_home AFTER UPDATE OF name ON worlds
BEGIN
  UPDATE entities SET name = NEW.name WHERE world_id = NEW.id AND is_home = TRUE;
END;

-- Optimistic concurrency (#130, ADR-0032): a body save is admitted by the UPDATE
-- access-rule only when its base `version` equals the row's; this trigger then advances
-- the stored counter. The client sends the base it last read, never version+1.
-- Recursion-safe: the WHEN guard is false on the bump's own re-update
-- (NEW.version <> OLD.version), so it fires exactly once per save.
CREATE TRIGGER entities_after_update_version AFTER UPDATE ON entities
FOR EACH ROW WHEN NEW.version = OLD.version
BEGIN
  UPDATE entities SET version = OLD.version + 1 WHERE id = NEW.id;
END;
