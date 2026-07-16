import { EdgeTargetKind, FieldSchema, ViewPlacement } from '@hexly/domain';
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
  // Instance Roles (ADR-0047): the account-wide powers this user holds, as one
  // zod-validated JSON set — `manage-users` and/or `create-worlds`. Never
  // DB-queried; loaded whole with the row and checked in code, like preferences.
  roles: text('roles').notNull().default('[]'),
  // Superadmin: the operator's repair bypass, OR'd into the read/reachability
  // predicates. Seeded via `--superadmin`; the last one is irremovable so the
  // repair capability can't be lost. Not an Instance Role — a separate flag.
  isSuperadmin: integer('is_superadmin', { mode: 'boolean' }).notNull().default(false),
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
  ],
);

/**
 * The sequence a freshly-inserted Entity or World starts at — no follower can hold anything older.
 * Both the column default and the value the write handles put on the row they return.
 */
export const INITIAL_SEQ = 1;

/**
 * An Entity stored as a single JSON document. The columns are the light attributes the
 * list view and access checks need; `document` holds the whole **Entity Document** — one open
 * key→value map, one shape for every Entity (ADR-0050, ADR-0051). `types`/`tags` are denormalized
 * out — each a multi-valued JSON array — so a list can group/filter without loading each document.
 * `version` is the optimistic-concurrency counter (a stale save is a 409). Ownership
 * is not a column — it is an `owner`-role row in `entityGrants`.
 */
export const entities = sqliteTable(
  'entities',
  {
    id: text('id').primaryKey(),
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id),
    name: text('name').notNull(),
    // The ordered Entity Type set (CONTEXT.md → Entity Type); `types[0]` is primary. A multi-valued
    // JSON array mirroring `tags`, unrolled with `json_each` for the Type facet and array-membership
    // filtering (ADR-0048).
    types: text('types', { mode: 'json' }).$type<string[]>().notNull(),
    // The ids of Fields attached directly to this Entity (CONTEXT.md → Field, ADR-0054): the
    // effective-set resolver unions these (instance precedence) with the types' default Fields.
    fields: text('fields', { mode: 'json' }).$type<string[]>().notNull().default([]),
    tags: text('tags', { mode: 'json' }).$type<string[]>().notNull(),
    // private | shared.
    visibility: text('visibility').notNull().default('private'),
    version: integer('version').notNull(),
    // The live-follow freshness key (ADR-0045): bumped by *every* committed change —
    // substance, exposure, sharing, lifecycle — by EntityWrites, the one write handle.
    // Distinct from `version` (a concurrency token that must not move on a sharing
    // change) and `updatedAt` (a user-visible timestamp that must not either).
    seq: integer('seq').notNull().default(INITIAL_SEQ),
    // The serialized Entity Document (entityDocumentSchema), validated at the edge.
    document: text('document').notNull(),
    // The Entity's searchable text: the Content's prose *and* the text each Field of a Structured Data Type's value
    // carries (a grid's Hex and Region names, #205). EntityWrites derives it on every write
    // (ADR-0045). Nullable: pre-FTS rows predate the column. The FTS table and its sync triggers are
    // raw SQL, outside Drizzle's typed API.
    contentText: text('content_text'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('idx_entities_world_id').on(table.worldId)],
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
  (table) => [primaryKey({ columns: [table.entityId, table.userId] })],
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
  pinnedEntityIds: text('pinned_entity_ids', { mode: 'json' }).$type<string[]>().notNull().default([]),
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
  (table) => [primaryKey({ columns: [table.worldId, table.userId] })],
);

/**
 * A World's user-defined Type Definitions (ADR-0048): an Entity Type a World Owner authors as data,
 * scoped to this World. Keyed by `(worldId, typeId)`; `typeId` is the immutable `world.`-namespaced
 * Entity Type key. Rows cascade with the World; writes route through {@link WorldWrites}.
 */
export const worldTypes = sqliteTable(
  'world_types',
  {
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    typeId: text('type_id').notNull(),
    label: text('label').notNull(),
    // The type's default Fields, referenced by id (`fieldRefs`, ADR-0054) — the sole Field declaration
    // now that inline schemas are gone. A JSON bag of `namespace.id` ids, never DB-queried; the
    // effective-set resolver loads it whole and composes it with the Entity's attached Fields.
    fieldRefs: text('field_refs', { mode: 'json' }).$type<string[]>().notNull().default([]),
    // The type's ordered View list (ViewPlacement[], ADR-0050, #201), what the "Show as a view" toggle
    // writes. Null is *not* an empty list: it means the author named no order, and the web defaults
    // it. The API stores and shape-validates the list, as it does `field_refs`; it never resolves a View.
    views: text('views', { mode: 'json' }).$type<ViewPlacement[]>(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.worldId, table.typeId] })],
);

/**
 * A World's user-defined **Fields** (CONTEXT.md → Field, ADR-0054): a first-class Field a World Owner
 * authors as data, scoped to this World. Keyed by `(worldId, fieldId)`; `fieldId` is the immutable
 * `world.`-namespaced reuse handle, split out so the id-less Field body rides in `definition` (a
 * FieldSchema, validated at the trust boundary). A JSON bag, never DB-queried — the resolver loads it
 * whole and composes it beside the Plugin fields. Rows cascade with the World; writes route through
 * {@link WorldWrites}.
 */
export const worldFields = sqliteTable(
  'world_fields',
  {
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    fieldId: text('field_id').notNull(),
    definition: text('definition', { mode: 'json' }).$type<FieldSchema>().notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.worldId, table.fieldId] })],
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
  (table) => [index('idx_world_links_world_id').on(table.worldId)],
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
  (table) => [index('idx_entity_links_entity_id').on(table.entityId)],
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
  (table) => [primaryKey({ columns: [table.worldId, table.hash] })],
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
  ],
);

/**
 * The denormalised **Field-facet** index (ADR-0048, #188): one row per distinct facetable Field
 * value an Entity's EntityDocument carries — the Field peer of the `types`/`tags` columns, pulled out so a
 * Field facet can be counted and filtered without loading each document. Like {@link entityEdges} it is
 * an **index, never a source of truth**: `EntityWrites` derives it from the Entity Document on every
 * save and Reindex rebuilds it, wholesale-replacing an Entity's rows (self-pruning). Deleting the
 * Entity cascades them away.
 *
 * `value` is the canonical string form; `num` is set only for a `number` Field, so a range filter
 * compares it numerically while an enum/date/string compares `value` lexically. `worldId` is
 * denormalised off the source, mirroring {@link entityEdges}, so a World-scoped facet read is one
 * indexed lookup. A `list` Field explodes to one row per item, so the composite PK is
 * `(entityId, key, value)`.
 */
export const entityFieldFacets = sqliteTable(
  'entity_field_facets',
  {
    entityId: text('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    worldId: text('world_id').notNull(),
    // The EntityDocument key the Field types.
    key: text('key').notNull(),
    // The canonical string form of the value; the facet value the rail lists and eq/date filters match.
    value: text('value').notNull(),
    // The numeric form of a `number` Field (else null), so a range filter compares as a number.
    num: real('num'),
  },
  (table) => [
    primaryKey({ columns: [table.entityId, table.key, table.value] }),
    // The World-scoped facet count and filter: group/match by (world, key, value).
    index('idx_entity_field_facets_key').on(table.worldId, table.key, table.value),
  ],
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
  (table) => [primaryKey({ columns: [table.entityId, table.descriptor] })],
);
