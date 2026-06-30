-- Share cascade + entity grants (#131, ADR-0024, ADR-0004). Slice #5 of the
-- TrailBase migration: the World-cascade and entity-level grants that CONTEXT.md
-- describes but the retired NestJS server never enforced (owner-scoped only). The
-- reads/writes these tables gate are declarative SQL access-rules in config.textproto.
-- Append-only/forward-only per ADR-0032. The account-less World Public Link
-- (world_links) is deferred to #138 — a READ access-rule can't validate a per-request
-- token, so it needs its own mechanism.

-- Named World membership below the Owner (ADR-0024): a `contributor` (creates
-- Entities, owns them, reads `shared`) or a `viewer` (reads `shared`). Surrogate
-- UUIDv7 PK because a Record API can't key off a composite PK (spike, #126); the
-- (world_id, user_id) pair is uniqued instead. ON DELETE CASCADE so deleting a
-- World drops its memberships (and keeps the e2e per-test reset clean).
CREATE TABLE world_members (
  id         BLOB    PRIMARY KEY NOT NULL CHECK(is_uuid_v7(id)) DEFAULT (uuid_v7()),
  world_id   BLOB    NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  user_id    BLOB    NOT NULL REFERENCES _user(id),
  role       TEXT    NOT NULL CHECK(role IN ('contributor', 'viewer')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(world_id, user_id)
) STRICT;

CREATE INDEX idx_world_members_world_id ON world_members (world_id);
CREATE INDEX idx_world_members_user_id ON world_members (user_id);

-- Entity-level grants (ADR-0004) on top of World sharing: an `editor` (async,
-- last-write-wins edits guarded by the Entity `version`) or a `viewer` (read-only) on
-- one specific Entity — the way to share a single `private` Entity with one person.
-- Same surrogate-PK + UNIQUE shape as world_members. ON DELETE CASCADE off entities.
CREATE TABLE entity_grants (
  id         BLOB    PRIMARY KEY NOT NULL CHECK(is_uuid_v7(id)) DEFAULT (uuid_v7()),
  entity_id  BLOB    NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  user_id    BLOB    NOT NULL REFERENCES _user(id),
  role       TEXT    NOT NULL CHECK(role IN ('editor', 'viewer')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(entity_id, user_id)
) STRICT;

CREATE INDEX idx_entity_grants_entity_id ON entity_grants (entity_id);
CREATE INDEX idx_entity_grants_user_id ON entity_grants (user_id);
