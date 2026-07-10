import { EdgeTargetKind } from '@hexly/domain';
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

// Keep in sync by hand with the `CREATE TABLE` DDL in `./db.ts`; column changes
// need a drizzle-kit migration to reach an existing database.

/**
 * The closed user set: no signup, users are provisioned out-of-band via the seed
 * mechanism. The password is stored as an argon2 hash; the plaintext never
 * touches the row.
 */
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  // Roaming Preferences as one zod-validated JSON bag; never DB-queried.
  preferences: text('preferences').notNull().default('{}'),
  // Instance Admin: account management with zero content powers — it pierces no
  // World or Entity. Toggled in-app by another Admin.
  isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
  // Superadmin: the operator's repair bypass, OR'd into the read/reachability
  // predicates. Seeded via `--superadmin`; the last one is irremovable so the
  // repair capability can't be lost.
  isSuperadmin: integer('is_superadmin', { mode: 'boolean' }).notNull().default(false),
  // Per-user capability gating World creation; orthogonal to Instance Admin,
  // granted by an Instance Admin. Off by default.
  canCreateWorlds: integer('can_create_worlds', { mode: 'boolean' }).notNull().default(false),
  // Non-null locks login (rejected in `authenticate`, killing live sessions too)
  // while leaving the user's data and memberships intact. Null = active.
  disabledAt: integer('disabled_at'),
  createdAt: integer('created_at').notNull(),
});

/**
 * Server-side sessions: the cookie carries only the opaque `id` (token); this
 * row is the source of truth. Logout deletes the row, so revocation is immediate.
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
    // Speeds up expired-session sweep (runs on every login).
    index('idx_sessions_expires_at').on(table.expiresAt),
  ]
);

/**
 * The sequence a freshly-inserted Entity or World starts at — no follower can hold anything
 * older. It is the column default *and* the value the write handles put on the row they return,
 * so the two cannot drift: a creator's held freshness always equals what the DB stored.
 */
export const INITIAL_SEQ = 1;

/**
 * An Entity stored as a single JSON document. The columns are the metadata the
 * list view and access checks need; `document` holds the whole type-discriminated
 * body. `type`/`tags` are denormalized out so a list can group/filter without
 * loading each body. `version` is the optimistic-concurrency counter (a stale
 * save is a 409). Ownership is not a column — it is an `owner`-role row in
 * `entityGrants`.
 */
export const entities = sqliteTable(
  'entities',
  {
    id: text('id').primaryKey(),
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id),
    name: text('name').notNull(),
    type: text('type').notNull(),
    tags: text('tags', { mode: 'json' }).$type<string[]>().notNull(),
    // private | shared.
    visibility: text('visibility').notNull().default('private'),
    version: integer('version').notNull(),
    // The live-follow freshness key (ADR-0045): bumped by *every* committed change —
    // substance, exposure, sharing, lifecycle — by EntityWrites, the one write handle.
    // Distinct from `version` (a concurrency token that must not move on a sharing
    // change) and `updatedAt` (a user-visible timestamp that must not either).
    seq: integer('seq').notNull().default(INITIAL_SEQ),
    // Serialized Entity body (entityBodySchema), validated at the edge.
    document: text('document').notNull(),
    // Plain-text prose extracted from Content for full-text search. EntityWrites derives it on
    // every write (ADR-0045), alongside the Link Descriptor index, so it can no longer be missed;
    // the boot backfill that once repaired NULL rows is gone with the gap it compensated for.
    // Still nullable: pre-FTS rows predate the column. The FTS table and its sync triggers are raw
    // SQL, outside Drizzle's typed API.
    contentText: text('content_text'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('idx_entities_world_id').on(table.worldId),
  ]
);

/**
 * The entity access-control set: one row per (entity, user), `role` ∈ owner |
 * editor | viewer. `owner` manages grants, carries the ≥1-Owner invariant
 * (enforced in EntitiesService, not the schema), and pierces `private`;
 * `editor`/`viewer` may target any Instance user (World membership is not a
 * precondition) and pierce `private` per-user. The PK makes re-granting an
 * upsert. Deleting the Entity cascades these rows away.
 */
export const entityGrants = sqliteTable(
  'entity_grants',
  {
    entityId: text('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role').notNull(),
  },
  (table) => [primaryKey({ columns: [table.entityId, table.userId] })]
);

/**
 * A World: a lightweight container grouping Entities for one campaign. World
 * Owners are `world_members` rows with `role: 'owner'` — no owner column here.
 * The landing page is a derived Dashboard, so a World holds no FK back to entities.
 */
export const worlds = sqliteTable('worlds', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  // The live-follow freshness key (ADR-0045), the World peer of `entities.seq`: every
  // committed change bumps it, including the membership mutations that deliberately
  // leave `updatedAt` alone so adding a member never reorders the World Index.
  seq: integer('seq').notNull().default(INITIAL_SEQ),
  // Owner-curated Dashboard pins: an ordered JSON array of Entity ids, one shared
  // set per World. References, not enforced FKs — stale or inaccessible ids are
  // filtered per-viewer on read, never pruned on delete.
  pinnedEntityIds: text('pinned_entity_ids', { mode: 'json' })
    .$type<string[]>()
    .notNull()
    .default([]),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/**
 * World membership: a user is an `owner` (full control — the World's ownership
 * set), a `contributor` (creates Entities, owns them, reads `shared`), or a
 * `viewer` (reads `shared`). One row per (world, user).
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
  (table) => [
    primaryKey({ columns: [table.worldId, table.userId] }),
  ]
);

/**
 * A World Public Link: an unguessable token granting anonymous Viewer access to
 * all `shared` Entities in a World. `id` is the token.
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
  (table) => [
    index('idx_world_links_world_id').on(table.worldId),
  ]
);

/**
 * A per-entity Public Link: an unguessable token granting anonymous read-only
 * access to one Entity. `id` is the token — an anonymous Viewer grant, so it
 * pierces `private` with no visibility check on the read. One active link per
 * Entity is enforced in the service. Deleting the Entity cascades.
 */
export const entityLinks = sqliteTable(
  'entity_links',
  {
    id: text('id').primaryKey(),
    entityId: text('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('idx_entity_links_entity_id').on(table.entityId)]
);

/**
 * Per-World content-addressed Assets: metadata only — the bytes live on disk at
 * `assets/<worldId>/<hash>.<ext>` beside the SQLite DB. The `(worldId, hash)` PK
 * makes dedup per-World. `originalFilename` survives (the on-disk name is the
 * hash) so export can write human-readable names. Rows cascade with the World;
 * the on-disk folder is removed separately by {@link AssetsService.deleteWorld}.
 */
export const assets = sqliteTable(
  'assets',
  {
    hash: text('hash').notNull(),
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    originalFilename: text('original_filename').notNull(),
    mime: text('mime').notNull(),
    size: integer('size').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.worldId, table.hash] })]
);

/**
 * The derived Entity Link index (ADR-0046): one row per distinct
 * `(sourceEntityId, targetKind, targetId, descriptor)` an Entity's document expresses.
 * An **index, never a source of truth** — droppable and recomputable from the documents,
 * wholesale-replaced by EntityWrites on every save.
 *
 * The rows are raw truth (A → B regardless of who may see either); confidentiality lives
 * entirely in the read, which filters an inbound edge by the viewer's access to its *source*.
 *
 * `targetId` deliberately carries **no FK**: a link to a missing or unreadable Entity is a valid
 * document, so it is unconstrained text resolved opportunistically on read. `worldId` is
 * denormalized off the source so the World Graph's edge fetch is one indexed lookup.
 */
export const entityEdges = sqliteTable(
  'entity_edges',
  {
    sourceEntityId: text('source_entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    worldId: text('world_id').notNull(),
    // entity | asset. Asset edges are stored but surface-less — groundwork for Asset GC.
    targetKind: text('target_kind').$type<EdgeTargetKind>().notNull(),
    // An `entityId`, or an Asset `hash`. Dangling-allowed, so no FK.
    targetId: text('target_id').notNull(),
    // The Link Descriptor, on `content → entity` edges alone. Two descriptors to the same
    // target are two edges ("spouse" *and* "rival" between one pair).
    descriptor: text('descriptor'),
  },
  (table) => [
    // Outbound: an Entity's References.
    index('idx_entity_edges_source').on(table.sourceEntityId),
    // Inbound: who links here (then filtered by the viewer's access to each source).
    index('idx_entity_edges_target').on(table.targetKind, table.targetId),
    // The World Graph's whole-World edge fetch.
    index('idx_entity_edges_world').on(table.worldId, table.targetKind),
  ]
);

/**
 * The owner's Link Descriptor vocabulary: the distinct relationship labels each
 * Entity's Content currently uses ("spouse", "capital of"). A successful save
 * *replaces* the entity's rows (self-pruning); deleting the Entity cascades them away.
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
    primaryKey({ columns: [table.entityId, table.descriptor] }),
  ]
);
