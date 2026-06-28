import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

// Keep in sync by hand with the `CREATE TABLE` DDL in `./db.ts`; column changes
// need a drizzle-kit migration to reach an existing database.

/**
 * The closed user set (ADR-0004). Users are provisioned out-of-band — there is
 * no signup — so this table only ever grows via the seed mechanism. The
 * password is stored as an argon2 hash; the plaintext never touches the row.
 */
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at').notNull(),
});

/**
 * Server-side sessions: the cookie carries only the opaque `id` (token); this
 * row is the source of truth. Logout deletes the row, so revocation is
 * immediate (ADR-0004 — logout ends the session).
 */
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [
    // Speeds up the expired-session sweep that runs on every login.
    index('idx_sessions_expires_at').on(table.expiresAt),
  ]
);

/**
 * An Entity stored as a single JSON document (ADR-0018, ADR-0002). The columns
 * are the metadata the list view and access checks need; `document` holds the
 * whole type-discriminated body as JSON. `type`/`tags` are denormalized out so
 * a list can group/filter without loading each body. `version` is the
 * optimistic-concurrency counter (a stale save is a 409). A Hex Map is an
 * Entity of `type: 'hexmap'` (replaces the `maps` table — migration in `db.ts`).
 */
export const entities = sqliteTable(
  'entities',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    // The World this Entity belongs to (ADR-0024); every Entity belongs to exactly
    // one. `() =>` is the standard lazy ref to a table defined below.
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id),
    // The World's Home Entity is the one flagged here (ADR-0024) — its landing
    // page. At most one per World (partial unique index below). Keeping the flag
    // on the Entity avoids a circular FK and makes the home intrinsically in-world.
    isHome: integer('is_home', { mode: 'boolean' }).notNull().default(false),
    name: text('name').notNull(),
    // The closed Entity type enum (note | hexmap), validated at the edge.
    type: text('type').notNull(),
    // Free-text tags as a JSON array; `mode: 'json'` serializes on the way in.
    tags: text('tags', { mode: 'json' }).$type<string[]>().notNull(),
    // Entity Visibility (ADR-0024): `private` | `shared`, default `private`.
    visibility: text('visibility').notNull().default('private'),
    version: integer('version').notNull(),
    // The serialized Entity body (entityBodySchema), parsed/validated at the edge.
    document: text('document').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    // The list endpoint and every access check filter by owner.
    index('idx_entities_owner_id').on(table.ownerId),
    // Reads scope to a World (ADR-0024 → in-world link picker, world sharing).
    index('idx_entities_world_id').on(table.worldId),
    // Exactly one Home Entity per World — partial unique over the flagged rows.
    uniqueIndex('idx_world_home')
      .on(table.worldId)
      .where(sql`${table.isHome} = 1`),
  ]
);

/**
 * A World (ADR-0024): a lightweight container grouping Entities for one campaign.
 * `owner_id` is the World Owner (not a member row). The Home Entity landing page
 * is the World's `is_home` Entity, not a column here — so a World holds no FK back
 * to entities (no circular dependency).
 */
export const worlds = sqliteTable(
  'worlds',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    // A user's Worlds list filters by owner.
    index('idx_worlds_owner_id').on(table.ownerId),
  ]
);

/**
 * Named World membership below the Owner (ADR-0024): a user is a `contributor`
 * (creates Entities, owns them, reads `shared`) or a `viewer` (reads `shared`).
 * One row per (world, user).
 */
export const worldMembers = sqliteTable(
  'world_members',
  {
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role').notNull(),
  },
  (table) => [primaryKey({ columns: [table.worldId, table.userId] })]
);

/**
 * A World Public Link (ADR-0024): an unguessable token granting World Viewer
 * access to all `shared` Entities in a World without an account. `id` is the token.
 */
export const worldLinks = sqliteTable(
  'world_links',
  {
    id: text('id').primaryKey(),
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('idx_world_links_world_id').on(table.worldId)]
);

/**
 * The owner's Link Descriptor vocabulary (#96, ADR-0023): the distinct relationship
 * labels each Entity's Content currently uses ("spouse", "capital of"). The client
 * harvests these from its opaque snapshot and a successful save *replaces* the entity's
 * rows, so the server never parses Content (ADR-0019). `::` suggestions are the owner's
 * `SELECT DISTINCT descriptor`. Self-pruning: a save that no longer carries a descriptor
 * drops its row; deleting the Entity cascades these away (FK `ON DELETE CASCADE`).
 */
export const entityDescriptors = sqliteTable(
  'entity_descriptors',
  {
    entityId: text('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    descriptor: text('descriptor').notNull(),
  },
  (table) => [
    // One row per (entity, descriptor); the harvested set is already distinct per entity.
    primaryKey({ columns: [table.entityId, table.descriptor] }),
  ]
);
