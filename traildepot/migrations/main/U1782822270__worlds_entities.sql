-- Worlds + Entities backbone on TrailBase Record APIs (#129, ADR-0032, ADR-0024).
-- Mirrors the retired Drizzle schema; UUIDv7 BLOB PKs are TrailBase's Record-API
-- requirement. Validation of `document` is client-side zod (ADR-0032); a
-- jsonschema CHECK backstop is deferred to the write-hardening slice (#4).

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
  document   TEXT    NOT NULL CHECK(is_json(document)),
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
