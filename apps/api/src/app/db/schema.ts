import {
  ContainerKind,
  DEFAULT_WORLD_KIND,
  EdgeTargetKind,
  FieldSchema,
  ViewPlacement,
  WorldKind,
  WorldTheme,
} from '@hexly/domain';
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
    // The {@link containers} row this Entity belongs to (ADR-0078). A World's Container id *is* the
    // World's id, so every World-scoped read still binds a World id here and no stored value moved.
    containerId: text('container_id')
      .notNull()
      .references(() => containers.id),
    name: text('name').notNull(),
    // The ordered Entity Type set (CONTEXT.md → Entity Type); `types[0]` is primary. A multi-valued
    // JSON array mirroring `tags`, unrolled with `json_each` for the Type facet and array-membership
    // filtering (ADR-0048).
    types: text('types', { mode: 'json' }).$type<string[]>().notNull(),
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
    // The **Thumbnail** Field's designated target `entityId` (CONTEXT.md → Thumbnail, ADR-0066): a derived,
    // nullable column EntityWrites materialises from the `core.field.thumbnail` entityLink value at the write
    // choke point (ADR-0045) and Reindex rebuilds — so a `thumbnails=1` list resolves the designation through
    // the asset dedup index (entityId → hash → served URL) as one indexed join, never a read-time
    // `json_extract`. **No FK**: a dangling link is a valid document (like `entityEdges.targetId`), and a
    // deleted target's dedup-index row cascades away, so the join degrades to no URL rather than erroring.
    thumbnailEntityId: text('thumbnail_entity_id'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('idx_entities_container_id').on(table.containerId)],
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
 * The kinds of Container (ADR-0078): a **World** a user authors into, or ADR-0079's **Compendium**
 * shelf. Declared in `@hexly/domain` since a **Mount** names it on the wire (ADR-0080), and re-exported
 * here so a schema reader finds the column's vocabulary beside the column.
 */
export type { ContainerKind };

/** The {@link containers} kind every World row carries. */
export const WORLD_CONTAINER_KIND: ContainerKind = 'world';

/** The {@link containers} kind every Compendium row carries (ADR-0079). */
export const COMPENDIUM_CONTAINER_KIND: ContainerKind = 'compendium';

/**
 * A **Container** (ADR-0078): what an Entity belongs to. It holds identity and the substance every
 * kind shares, while a satellite table keyed by this `id` holds what only one kind has.
 */
export const containers = sqliteTable('containers', {
  id: text('id').primaryKey(),
  // Which satellite completes this row. Never the discriminator a read filters on — joining the
  // satellite is, so a World-scoped read cannot see a Compendium even by omission.
  kind: text('kind').$type<ContainerKind>().notNull(),
  name: text('name').notNull(),
  // The live-follow freshness key (ADR-0045), the Container peer of `entities.seq`: every
  // committed change bumps it, including the membership mutations that deliberately
  // leave `updatedAt` alone so adding a member never reorders the World Index.
  seq: integer('seq').notNull().default(INITIAL_SEQ),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/**
 * A World: the Container kind grouping Entities for one campaign. Identity lives on the
 * {@link containers} row this `id` names (ADR-0078); only what a World alone has stays here. World
 * Owners are `world_members` rows with `role: 'owner'` — no owner column here. The landing page is
 * a derived Dashboard, so a World holds no FK back to entities.
 */
export const worlds = sqliteTable('worlds', {
  id: text('id')
    .primaryKey()
    .references(() => containers.id, { onDelete: 'cascade' }),
  // Campaign-or-Shelf (ADR-0080): a label the World Index groups by and that **no read filters on**.
  // Deliberately not the {@link containers} `kind` beside it — that one says which satellite completes
  // the row, this one says what the World is kept for, and a Shelf is a World in every other respect.
  kind: text('kind').$type<WorldKind>().notNull().default(DEFAULT_WORLD_KIND),
  // Owner-curated Dashboard pins: an ordered JSON array of Entity ids, one shared
  // set per World. References, not enforced FKs — stale or inaccessible ids are
  // filtered per-viewer on read, never pruned on delete.
  pinnedEntityIds: text('pinned_entity_ids', { mode: 'json' }).$type<string[]>().notNull().default([]),
  // The Owner-authored World Theme (ADR-0076), stored inline and patched wholesale like the pins.
  // Every value reached this column re-serialised from its own parse; NULL is no Theme.
  theme: text('theme', { mode: 'json' }).$type<WorldTheme>(),
});

/**
 * A whole stored World: its {@link containers} identity row joined to its {@link worlds} satellite.
 * The two are keyed by the same id, so the join reads as one flat row.
 *
 * The Container's own `kind` is dropped: it is `'world'` for every row here by construction, and the
 * `kind` a World *has* is the satellite's campaign-or-Shelf label (ADR-0080).
 */
export type WorldRow = Omit<typeof containers.$inferSelect, 'kind'> & Omit<typeof worlds.$inferSelect, 'id'>;

/**
 * A **Compendium** (ADR-0079): the Container kind holding one installed pack of published reference
 * material, Instance-wide. The {@link worlds} peer — identity lives on the {@link containers} row this
 * `id` names, and only what a Compendium alone has stays here. It has no members, no public link, no
 * Theme and no pins *by construction*: those tables key on {@link worlds}, which a Compendium has no
 * row in (ADR-0078).
 *
 * `importer` is the **Compendium Importer** that produced this shelf, and it is `unique`: one
 * Compendium per pack, which is what lets the reconcile's match key collapse from
 * `(container, importer)` to the container alone. `rev` is the pinned source revision the entries
 * currently reflect, and the three attribution columns are the pack's terms — publisher, license, and
 * the verbatim notice — all captured from the Importer's declaration on install and re-captured on
 * reimport, so they render where the content is read (#402) instead of only in the plugin's source
 * tree (ADR-0061). Attribution is nullable throughout: a pack may state none.
 */
export const compendiums = sqliteTable('compendiums', {
  id: text('id')
    .primaryKey()
    .references(() => containers.id, { onDelete: 'cascade' }),
  // The one Compendium Importer that owns this shelf — the lookup "where does this Importer land?"
  // and, being unique, the guarantee that answer is a single Container.
  importer: text('importer').notNull().unique(),
  rev: text('rev').notNull(),
  publisher: text('publisher'),
  license: text('license'),
  notice: text('notice'),
});

/**
 * A whole stored Compendium: its {@link containers} identity row joined to its {@link compendiums}
 * satellite, the {@link WorldRow} peer.
 */
export type CompendiumRow = typeof containers.$inferSelect & Omit<typeof compendiums.$inferSelect, 'id'>;

/**
 * The **Mounts** a Container declares (ADR-0080): the Containers it draws from, `container_id` the
 * mounting side and `mounted_container_id` the mounted one. The pair is the primary key, so the same
 * Mount declared twice is one row; `position` is order alone, never identity, which is what lets a
 * reorder rewrite it wholesale.
 *
 * Both columns key {@link containers} rather than {@link worlds} though only a World may mount: the
 * generic name leaves room for a kind that does without implying one exists, and "a Compendium may not
 * mount" is the write path's, which resolves its mounting Container through `worlds`. Both FKs cascade,
 * so deleting either Container drops the Mount with it.
 *
 * No `seq` of its own — a Mount change bumps the mounting World's, so it rides that freshness key like
 * a membership change. Written through {@link WorldWrites}.
 */
export const containerMounts = sqliteTable(
  'container_mounts',
  {
    containerId: text('container_id')
      .notNull()
      .references(() => containers.id, { onDelete: 'cascade' }),
    mountedContainerId: text('mounted_container_id')
      .notNull()
      .references(() => containers.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.containerId, table.mountedContainerId] }),
    // "Who mounts this Container?" — the direction the primary key does not serve, and the one a
    // cascade-on-delete and every read behind this ticket asks.
    index('idx_container_mounts_mounted').on(table.mountedContainerId),
  ],
);

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
 * A Container's user-defined Type Definitions (ADR-0048): an Entity Type a World Owner authors as
 * data. The authored vocabulary belongs to the **Container**, not the World (ADR-0078), so it can
 * travel with the content it types. Keyed by `(containerId, typeId)`; `typeId` is the immutable
 * `world.`-namespaced Entity Type key. Rows cascade with the Container — and a World's satellite
 * cascades off the same row, so deleting a World still takes its types with it. Writes route through
 * {@link WorldWrites}.
 */
export const worldTypes = sqliteTable(
  'world_types',
  {
    containerId: text('container_id')
      .notNull()
      .references(() => containers.id, { onDelete: 'cascade' }),
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
  (table) => [primaryKey({ columns: [table.containerId, table.typeId] })],
);

/**
 * A Container's user-defined **Fields** (CONTEXT.md → Field, ADR-0054): a first-class Field a World
 * Owner authors as data. Belongs to the **Container** beside {@link worldTypes} (ADR-0078). Keyed by
 * `(containerId, fieldId)`; `fieldId` is the immutable `world.`-namespaced reuse handle, split out so
 * the id-less Field body rides in `definition` (a FieldSchema, validated at the trust boundary). A JSON
 * bag, never DB-queried — the resolver loads it whole and composes it beside the Plugin fields. Rows
 * cascade with the Container; writes route through {@link WorldWrites}.
 */
export const worldFields = sqliteTable(
  'world_fields',
  {
    containerId: text('container_id')
      .notNull()
      .references(() => containers.id, { onDelete: 'cascade' }),
    fieldId: text('field_id').notNull(),
    definition: text('definition', { mode: 'json' }).$type<FieldSchema>().notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.containerId, table.fieldId] })],
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
 * The derived **Asset dedup index** (ADR-0065): one row per Asset Entity, mapping the content `hash` of
 * the bytes its asset-ref wraps to the Entity that owns them. The `entityImportSource` pattern — an
 * **index, never a source of truth**: `EntityWrites` materialises it from the document at the write choke
 * point and Reindex rebuilds it, so an upload resolves dedup, and byte serving reads disk with no table
 * consulted at all. Deleting the Entity cascades the row away; the on-disk bytes are dropped separately.
 *
 * `entityId` is the PK — an Asset carries at most one asset-ref. `containerId` is denormalised off the
 * source, mirroring the other derived indexes; the unique `(containerId, hash)` is the per-Container dedup
 * key the upload mint-and-dedup resolves against (re-uploading identical bytes returns the existing Asset).
 *
 * `ext` completes the byte address `<containerId>/<hash><ext>` — the same folder {@link AssetsService}
 * has always written under, since a World's Container id is the World's id — so a presence check is one
 * stat (#325). Nullable: a row predating the column has an unknown address, which is never reported
 * missing.
 */
export const assetIndex = sqliteTable(
  'asset_index',
  {
    entityId: text('entity_id')
      .primaryKey()
      .references(() => entities.id, { onDelete: 'cascade' }),
    containerId: text('container_id').notNull(),
    hash: text('hash').notNull(),
    ext: text('ext'),
  },
  (table) => [uniqueIndex('idx_asset_index_dedup').on(table.containerId, table.hash)],
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
 * document, so it is unconstrained text resolved opportunistically on read. `containerId` is
 * denormalized off the source so the World Graph's edge fetch is one indexed lookup; `targetContainerId`
 * is the *target's*, which an asset URL names for itself (ADR-0080).
 */
export const entityEdges = sqliteTable(
  'entity_edges',
  {
    sourceEntityId: text('source_entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    containerId: text('container_id').notNull(),
    // entity | asset. Asset-hash edges are ordinary Decor Links now (ADR-0069) — hidden by
    // default on relation surfaces, always counted in inbound usage.
    targetKind: text('target_kind').$type<EdgeTargetKind>().notNull(),
    // An `entityId`, or an Asset `hash`. Dangling-allowed, so no FK.
    targetId: text('target_id').notNull(),
    // The Container the target lives in, on an `asset` edge alone — read off the `/assets/<containerId>/…`
    // URL the document was written with, never assumed to be the source's (ADR-0080). NULL on an `entity`
    // edge and on a row predating this column; both resolve against `containerId`, which is what a World
    // that draws on nothing has always meant. Dangling-allowed, so no FK.
    targetContainerId: text('target_container_id'),
    // The Link Descriptor, on `content → entity` edges alone. Two descriptors to the same
    // target are two edges ("spouse" *and* "rival" between one pair).
    descriptor: text('descriptor'),
    // A **Decor Link** (ADR-0069): the edge exists for presentation, not worldbuilding meaning —
    // written at harvest by the edge's producer (capability-URL images, `decor` Fields), rebuilt by
    // Reindex. Relation reads (World Graph, outbound References) filter on it; usage reads count it.
    decor: integer('decor', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => [
    // Outbound: an Entity's References.
    index('idx_entity_edges_source').on(table.sourceEntityId),
    // Inbound: who links here (then filtered by the viewer's access to each source).
    index('idx_entity_edges_target').on(table.targetKind, table.targetId),
    // The World Graph's whole-World edge fetch.
    index('idx_entity_edges_container').on(table.containerId, table.targetKind),
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
 * compares it numerically while an enum/date/string compares `value` lexically. `containerId` is
 * denormalised off the source, mirroring {@link entityEdges}, so a Container-scoped facet read is one
 * indexed lookup. A `list` Field explodes to one row per item, so the composite PK is
 * `(entityId, key, value)`.
 */
export const entityFieldFacets = sqliteTable(
  'entity_field_facets',
  {
    entityId: text('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    containerId: text('container_id').notNull(),
    // The EntityDocument key the Field types.
    key: text('key').notNull(),
    // The canonical string form of the value; the facet value the rail lists and eq/date filters match.
    value: text('value').notNull(),
    // The numeric form of a `number` Field (else null), so a range filter compares as a number.
    num: real('num'),
  },
  (table) => [
    primaryKey({ columns: [table.entityId, table.key, table.value] }),
    // The Container-scoped facet count and filter: group/match by (container, key, value).
    index('idx_entity_field_facets_key').on(table.containerId, table.key, table.value),
  ],
);

/**
 * The derived **Import Source** index (ADR-0060): one row per Entity whose EntityDocument carries the
 * reserved `hexly.source` provenance — which `importer` produced it, its stable upstream `sourceId`, and
 * the pinned `rev` it reflects. Like {@link entityEdges} and {@link entityFieldFacets} it is an
 * **index, never a source of truth**: `EntityWrites` materialises it from the document at the write
 * choke point and Reindex rebuilds it, so a provenance filter ("what did this Importer create here")
 * answers with Entity ids alone, never loading a document blob. Deleting the Entity cascades the row away.
 *
 * `entityId` is the PK — an Entity carries at most one Import Source. `containerId` is denormalised off the
 * source, mirroring the other derived indexes, so a `(container, importer)` wipe/query is one indexed
 * lookup; the unique `(container, importer, sourceId)` is the reconcile's identity-preserving
 * upsert-match key.
 */
export const entityImportSource = sqliteTable(
  'entity_import_source',
  {
    entityId: text('entity_id')
      .primaryKey()
      .references(() => entities.id, { onDelete: 'cascade' }),
    containerId: text('container_id').notNull(),
    importer: text('importer').notNull(),
    sourceId: text('source_id').notNull(),
    rev: text('rev').notNull(),
  },
  (table) => [
    // Wipe/query: every Entity an Importer created in a Container.
    index('idx_entity_import_source_container_importer').on(table.containerId, table.importer),
    // The reconcile's upsert-match key: one Entity per (container, importer, sourceId).
    uniqueIndex('idx_entity_import_source_upsert').on(table.containerId, table.importer, table.sourceId),
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
