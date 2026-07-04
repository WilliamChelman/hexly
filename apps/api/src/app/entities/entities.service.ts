import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import {
  CreateEntityRequest,
  emptyEntityBody,
  EntityBody,
  entityBodySchema,
  EntityDetail,
  EntityFacets,
  EntitySaveOutcome,
  EntitySummary,
  EntityType,
  FacetCount,
  entityTypeSchema,
  extractText,
  Visibility,
  descriptorsSchema,
  harvestDescriptors,
  SaveEntityRequest,
  tagsSchema,
  visibilitySchema,
} from '@hexly/domain';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { OwnerSetResult, removeOwnerOutcome, userExists } from '../acl/owner-set';
import { DB, Db } from '../db/db';
import {
  entities,
  entityDescriptors,
  entityOwners,
  worldMembers,
  worlds,
} from '../db/schema';
import { HEXLY_CONFIG, HexlyConfig } from '../config/config.module';

/**
 * Access predicate for this slice (ADR-0037, #158): a row is the caller's iff
 * they are one of its Owners — an `entity_owners` row. An EXISTS keeps it a
 * per-row predicate that composes into every owner-scoped query untouched (later
 * slices widen it to grants and World-shared visibility).
 */
function ownsEntity(userId: string) {
  return sql`EXISTS (SELECT 1 FROM ${entityOwners} WHERE ${entityOwners.entityId} = ${entities.id} AND ${entityOwners.userId} = ${userId})`;
}

const INITIAL_VERSION = 1;

/** Owner-scoped paging + filtering options for {@link EntitiesService.list} (ADR-0025). */
export interface ListOptions {
  readonly offset: number;
  readonly limit: number;
  /** Restrict to an explicit id set (owner-scoped); unknown ids drop out silently. */
  readonly ids?: readonly string[];
  /** Case-insensitive substring match on the name. */
  readonly q?: string;
  /** Facet: restrict to any of these Entity Types (OR within category, #155). */
  readonly type?: readonly EntityType[];
  /** Facet: restrict to entities carrying any of these Tags (OR within category, #155). */
  readonly tags?: readonly string[];
  /** Facet: restrict to any of these Visibilities (OR within category, #155). */
  readonly visibility?: readonly Visibility[];
  /** Restrict to one World (ADR-0024). */
  readonly worldId?: string;
}

/** The filter state a facet-count read narrows against (#155) — the list filters minus paging/ids. */
export type FacetOptions = Pick<
  ListOptions,
  'worldId' | 'q' | 'type' | 'tags' | 'visibility'
>;

/** Everything {@link filters} reads — shared by the paged list and the facet-count reads (#155). */
type FilterOptions = FacetOptions & Pick<ListOptions, 'ids'>;

/** One page of summaries plus whether a further page exists (drives the cursor). */
export interface ListPage {
  readonly items: EntitySummary[];
  readonly hasMore: boolean;
}

/**
 * The shared {@link EntitySaveOutcome} (`saved`/`conflict`) plus an api-local
 * `not-found` arm that maps to a 404 rather than a JSON body (ADR-0018).
 */
export type SaveResult = EntitySaveOutcome | { status: 'not-found' };

/**
 * Entity persistence: one JSON body per `entities` row (ADR-0018, ADR-0002).
 * Access is scoped to the Entity's ownership set (ADR-0037): the service only
 * returns or mutates a row the caller is an Owner of — see {@link ownsEntity} and
 * {@link ownedRow}. Body serialization and `version` bookkeeping live here.
 */
@Injectable()
export class EntitiesService implements OnApplicationBootstrap {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(HEXLY_CONFIG) private readonly config: HexlyConfig,
  ) {}

  /**
   * One-time boot backfill (ADR-0035): populate `content_text` — and, through the
   * FTS triggers, the search index — for rows written before the column existed, so
   * an already-imported vault becomes searchable without re-saving a single note.
   * Scoped to still-`NULL` rows, so it is a no-op on every boot after the first
   * (a written note always has a non-null, possibly empty, `content_text`).
   */
  onApplicationBootstrap(): void {
    const stale = this.db
      .select({ id: entities.id, document: entities.document })
      .from(entities)
      .where(isNull(entities.contentText))
      .all();
    for (const row of stale) {
      const contentText = extractText(parseDocument(row.id, row.document).content);
      this.db.update(entities).set({ contentText }).where(eq(entities.id, row.id)).run();
    }
  }

  /**
   * One owner-scoped page of summaries (ADR-0025), metadata only. Stable sort
   * (newest first, tied by id) prevents overlaps/skips. Reads limit + 1 rows
   * to detect further pages without phantom empty page.
   */
  list(ownerId: string, opts: ListOptions): ListPage {
    // A text query becomes an FTS5 MATCH (ADR-0035): full-text over name, tags,
    // and Content prose, ranked by bm25. Absent (or all-punctuation) → keep the
    // last-edited order. Skip potentially large document column.
    const match = opts.q ? toFtsMatch(opts.q) : null;
    const w = this.config.search.weights;
    const query = this.db
      .select({
        id: entities.id,
        worldId: entities.worldId,
        name: entities.name,
        type: entities.type,
        tags: entities.tags,
        visibility: entities.visibility,
        version: entities.version,
        createdAt: entities.createdAt,
        updatedAt: entities.updatedAt,
      })
      .from(entities)
      .$dynamic();
    if (match) {
      query.innerJoin(sql`entities_fts`, sql`entities_fts.rowid = entities.rowid`);
    }
    const rows = query
      .where(
        and(
          ownsEntity(ownerId),
          ...filters(opts),
          match ? sql`entities_fts MATCH ${match}` : undefined,
        ),
      )
      // With a query, best match first (bm25 ascending), id for a stable page
      // boundary; without one, the existing newest-first order (ADR-0025). The
      // per-column weights (name/tags/content) are the configured relevance tuning
      // (ADR-0035) — column order must match the FTS DDL: name, tags, content_text.
      .orderBy(
        ...(match
          ? [
              sql`bm25(entities_fts, ${w.name}, ${w.tags}, ${w.content})`,
              asc(entities.id),
            ]
          : [desc(entities.updatedAt), asc(entities.id)]),
      )
      .limit(opts.limit + 1)
      .offset(opts.offset)
      .all();

    const hasMore = rows.length > opts.limit;
    const items = rows.slice(0, opts.limit).map(toSummary);
    return { items, hasMore };
  }

  /**
   * Facet-count read for the Facet rail (#155). For each category, count its
   * distinct values under the *other* active constraints (query + the other
   * Facets) but **not** its own — so drilling into one category still lists the
   * sibling values you could add, each narrowed by everything else. `GROUP BY`
   * naturally omits zero-count values (a value with no rows never appears).
   * Owner- and World-scoped like {@link list}.
   */
  facets(ownerId: string, opts: FacetOptions): EntityFacets {
    return {
      // Drop a category's own selection before counting it (drill-down).
      type: this.countColumn(ownerId, { ...opts, type: undefined }, entities.type),
      visibility: this.countColumn(
        ownerId,
        { ...opts, visibility: undefined },
        entities.visibility,
      ),
      tag: this.countTags(ownerId, { ...opts, tags: undefined }),
    };
  }

  /** Count a denormalized column's values (type/visibility) under `opts`. */
  private countColumn(
    ownerId: string,
    opts: FacetOptions,
    column: typeof entities.type | typeof entities.visibility,
  ): FacetCount[] {
    const match = opts.q ? toFtsMatch(opts.q) : null;
    const query = this.db
      .select({ value: column, count: sql<number>`count(*)`.as('count') })
      .from(entities)
      .$dynamic();
    if (match) {
      query.innerJoin(sql`entities_fts`, sql`entities_fts.rowid = entities.rowid`);
    }
    return query
      .where(facetWhere(ownerId, opts, match))
      .groupBy(column)
      .all()
      .map((r) => ({ value: r.value as string, count: r.count }));
  }

  /**
   * Count Tag-facet values under `opts`. Tags live in the JSON `tags` column, so
   * `json_each` unrolls each entity's array into rows before grouping — an entity
   * with two tags counts toward both values (ADR-0035, #155).
   */
  private countTags(ownerId: string, opts: FacetOptions): FacetCount[] {
    const match = opts.q ? toFtsMatch(opts.q) : null;
    const query = this.db
      .select({
        value: sql<string>`tag.value`.as('value'),
        count: sql<number>`count(*)`.as('count'),
      })
      .from(entities)
      .innerJoin(sql`json_each(${entities.tags}) as tag`, sql`1 = 1`)
      .$dynamic();
    if (match) {
      query.innerJoin(sql`entities_fts`, sql`entities_fts.rowid = entities.rowid`);
    }
    return query
      .where(facetWhere(ownerId, opts, match))
      .groupBy(sql`tag.value`)
      .all()
      .map((r) => ({ value: r.value, count: r.count }));
  }

  /**
   * An Entity owned by someone else is indistinguishable from one that does not
   * exist, so ownership never leaks (ADR-0004).
   */
  load(ownerId: string, id: string): EntityDetail | null {
    const row = this.ownedRow(ownerId, id);
    return row ? toDetail(row) : null;
  }

  /**
   * Every Entity in a World, bodies included, for the vault export (ADR-0033, #150).
   * Owner-scoped like the rest of the service — a member never reaches another owner's
   * bodies. Unlike {@link list} this pulls the full `document` column (export serializes it).
   */
  listByWorld(ownerId: string, worldId: string): EntityDetail[] {
    return this.db
      .select()
      .from(entities)
      .where(and(ownsEntity(ownerId), eq(entities.worldId, worldId)))
      .all()
      .map(toDetail);
  }

  create(ownerId: string, req: CreateEntityRequest): EntityDetail {
    const body = emptyEntityBody(req.type);
    const row = this.insertEntity({
      ownerId,
      worldId: this.resolveWorldId(ownerId, req.worldId),
      name: req.name,
      tags: req.tags,
      body,
    });
    // Already have valid body; return without re-parsing.
    return detailOf(row, body);
  }

  /**
   * Insert a fully-built Entity for the vault import path (ADR-0033, #146): unlike
   * {@link create} (which mints an empty body server-side), the Content and Metadata
   * come pre-converted from the source markdown. The target World is the caller's
   * freshly minted import World, so no ownership resolution is needed.
   */
  importNote(
    ownerId: string,
    worldId: string,
    id: string,
    name: string,
    tags: readonly string[],
    body: EntityBody,
  ): void {
    this.insertEntity({ id, ownerId, worldId, name, tags, body });
  }

  /**
   * Populate a World's auto-created Home Entity from a re-imported `hexly.isHome` note
   * (ADR-0033, #150): update its Content, Metadata, and Tags in place rather than inserting a
   * duplicate note. The Home's name stays the World name (ADR-0029) and its `is_home` flag is
   * untouched — only the body a Hexly export round-trips back is written.
   */
  importHome(ownerId: string, homeEntityId: string, tags: readonly string[], body: EntityBody): void {
    this.db
      .update(entities)
      .set({
        document: serialize(body),
        tags: [...tags],
        contentText: extractText(body.content),
        updatedAt: Date.now(),
      })
      .where(and(eq(entities.id, homeEntityId), ownsEntity(ownerId)))
      .run();
  }

  /**
   * The single INSERT trunk both {@link create} and {@link importNote} share, so the
   * row shape (id, initial version, private, serialized body, timestamps) lives in one
   * place and can't drift. Callers vary only what they own — World, name, tags, body.
   * Returns the inserted row so a caller can build its {@link EntityDetail} without a re-read.
   */
  private insertEntity(input: {
    /** Pre-generated id — the import path assigns ids up front so it can resolve wikilinks before insert (#147). */
    id?: string;
    ownerId: string;
    worldId: string;
    name: string;
    tags: readonly string[];
    body: EntityBody;
  }) {
    const now = Date.now();
    const row = {
      id: input.id ?? randomUUID(),
      worldId: input.worldId,
      name: input.name,
      type: input.body.type,
      tags: [...input.tags],
      visibility: 'private' as const,
      version: INITIAL_VERSION,
      document: serialize(input.body),
      // Search index text (ADR-0035); the FTS triggers pick it up from the column.
      contentText: extractText(input.body.content),
      isHome: false,
      createdAt: now,
      updatedAt: now,
    };
    // Row and its sole initial Owner land together (ADR-0037) — a new Entity is
    // never ownerless. The creator is the initial sole member of its owner set.
    this.db.transaction(() => {
      this.db.insert(entities).values(row).run();
      this.db.insert(entityOwners).values({ entityId: row.id, userId: input.ownerId }).run();
    });
    return row;
  }

  /**
   * Version-checked save (ADR-0018, ADR-0004). Concurrent edit is a conflict,
   * not silent overwrite. Guard is atomic: base version in WHERE predicate.
   */
  save(ownerId: string, id: string, req: SaveEntityRequest): SaveResult {
    // Read first for not-found and to preserve untouched columns in response.
    const row = this.ownedRow(ownerId, id);
    if (!row) return { status: 'not-found' };

    // Set only columns a save owns so concurrent renames aren't clobbered.
    // Tags always fully replace (save carries full set, #72).
    const document = serialize(req.document);
    const contentText = extractText(req.document.content);
    // Descriptors are derived from the saved Content, not sent by the client (#96,
    // ADR-0023/0035): harvest the links' relationship labels, normalized like tags.
    const descriptors = descriptorsSchema.parse(harvestDescriptors(req.document.content));
    const version = req.version + 1;
    const updatedAt = Date.now();
    // Body write and descriptor-index replace in one transaction (ADR-0023) so
    // index always reflects last-successful-save state, never rejected saves.
    const saved = this.db.transaction(() => {
      const res = this.db
        .update(entities)
        .set({ document, contentText, version, updatedAt, tags: req.tags })
        .where(
          and(
            eq(entities.id, id),
            ownsEntity(ownerId),
            eq(entities.version, req.version),
          ),
        )
        .run();
      if (res.changes === 0) return false;
      this.replaceDescriptors(id, descriptors);
      return true;
    });
    if (!saved) {
      // Version moved between read and write; re-read to report current state.
      const current = this.ownedRow(ownerId, id);
      return current
        ? { status: 'conflict', current: toDetail(current) }
        : { status: 'not-found' };
    }
    // Return validated body we just wrote directly.
    return {
      status: 'saved',
      entity: detailOf(
        { ...row, version, updatedAt, tags: req.tags },
        req.document,
      ),
    };
  }

  /**
   * Metadata only: leaves body and version untouched so rename doesn't
   * invalidate an in-progress edit's base version.
   */
  rename(ownerId: string, id: string, name: string): EntityDetail | null {
    const row = this.ownedRow(ownerId, id);
    if (!row) return null;
    const updatedAt = Date.now();
    this.db
      .update(entities)
      .set({ name, updatedAt })
      .where(and(eq(entities.id, id), ownsEntity(ownerId)))
      .run();
    return toDetail({ ...row, name, updatedAt });
  }

  /**
   * Owner's `::` suggestion vocabulary (#96, ADR-0023): DISTINCT Link Descriptors
   * across their entities. Reflects last-saved state (reads the index, not edits).
   */
  listDescriptors(ownerId: string): string[] {
    return this.db
      .selectDistinct({ descriptor: entityDescriptors.descriptor })
      .from(entityDescriptors)
      .innerJoin(entities, eq(entities.id, entityDescriptors.entityId))
      .where(ownsEntity(ownerId))
      .orderBy(asc(entityDescriptors.descriptor))
      .all()
      .map((row) => row.descriptor);
  }

  /**
   * Owner's tag suggestion vocabulary: DISTINCT Tags across their entities,
   * sorted. Tags live in the JSON `tags` column, so `json_each` unrolls each array
   * before DISTINCT (the shape countTags uses). No index table — unlike descriptors,
   * tags are already a first-class column, so this reads live rather than harvested.
   */
  listTags(ownerId: string): string[] {
    return this.db
      .selectDistinct({ value: sql<string>`tag.value` })
      .from(entities)
      .innerJoin(sql`json_each(${entities.tags}) as tag`, sql`1 = 1`)
      .where(ownsEntity(ownerId))
      .orderBy(sql`tag.value`)
      .all()
      .map((row) => row.value);
  }

  /**
   * Replace entity's descriptor rows with harvested set (#96). Self-pruning:
   * dropped descriptors lose rows. Runs in save's transaction on success.
   */
  private replaceDescriptors(id: string, descriptors: readonly string[]): void {
    this.db.delete(entityDescriptors).where(eq(entityDescriptors.entityId, id)).run();
    if (descriptors.length === 0) return;
    this.db
      .insert(entityDescriptors)
      .values(descriptors.map((descriptor) => ({ entityId: id, descriptor })))
      .run();
  }

  // false: unknown id or not an Owner's (caller surfaces as 404).
  delete(ownerId: string, id: string): boolean {
    const row = this.db
      .select({ isHome: entities.isHome })
      .from(entities)
      .where(and(eq(entities.id, id), ownsEntity(ownerId)))
      .get();
    if (!row) return false;
    // 409, not 400: conflicts with World invariant (Home Entity always exists, ADR-0024).
    if (row.isHome) throw new ConflictException('The Home Entity cannot be deleted');
    // entity_owners cascades with the row.
    this.db.delete(entities).where(eq(entities.id, id)).run();
    return true;
  }

  /**
   * The Entity's ownership set, for an Owner (ADR-0037). A non-Owner can't reach the
   * Entity at all this slice, so unreachable-and-forbidden both read as 404 (the
   * controller maps `not-found`); the reachable-but-forbidden 403 arrives with the
   * visibility slice.
   */
  listOwners(userId: string, id: string): OwnerSetResult {
    if (!this.ownedRow(userId, id)) return { status: 'not-found' };
    return { status: 'ok', owners: this.entityOwnersOf(id) };
  }

  /**
   * Add a co-Owner to an Entity (ADR-0037): Owner-only, the target must be an existing
   * Instance user. Idempotent — re-adding an existing Owner is a no-op returning the set.
   */
  addOwner(userId: string, id: string, targetUserId: string): OwnerSetResult {
    if (!this.ownedRow(userId, id)) return { status: 'not-found' };
    if (!userExists(this.db, targetUserId)) return { status: 'no-such-user' };
    this.db
      .insert(entityOwners)
      .values({ entityId: id, userId: targetUserId })
      .onConflictDoNothing()
      .run();
    return { status: 'ok', owners: this.entityOwnersOf(id) };
  }

  /**
   * Remove an Owner from an Entity, or resign your own ownership (ADR-0037): Owner-only.
   * The ≥1-Owner invariant refuses removing the last Owner (`last-owner` → 409). A
   * co-Owner may evict any other Owner, including the creator.
   */
  removeOwner(userId: string, id: string, targetUserId: string): OwnerSetResult {
    if (!this.ownedRow(userId, id)) return { status: 'not-found' };
    const outcome = removeOwnerOutcome(this.entityOwnersOf(id), targetUserId);
    if (outcome.status !== 'ok') return outcome;
    this.db
      .delete(entityOwners)
      .where(and(eq(entityOwners.entityId, id), eq(entityOwners.userId, targetUserId)))
      .run();
    return outcome;
  }

  /** The Entity's Owner user ids (ADR-0037), ordered stably. */
  private entityOwnersOf(id: string): string[] {
    return this.db
      .select({ userId: entityOwners.userId })
      .from(entityOwners)
      .where(eq(entityOwners.entityId, id))
      .orderBy(asc(entityOwners.userId))
      .all()
      .map((r) => r.userId);
  }

  /**
   * Resolve target World for new Entity (ADR-0024). Supplied worldId must be
   * owned by ownerId. Absent worldId defaults to owner's oldest World.
   */
  private resolveWorldId(ownerId: string, requestedId?: string): string {
    // World ownership is a membership row now (ADR-0037): the caller must be an
    // Owner (role 'owner') of the target World.
    const owned = and(
      eq(worldMembers.userId, ownerId),
      eq(worldMembers.role, 'owner'),
    );
    const world = this.db
      .select({ id: worlds.id })
      .from(worlds)
      .innerJoin(worldMembers, eq(worldMembers.worldId, worlds.id))
      .where(requestedId ? and(eq(worlds.id, requestedId), owned) : owned)
      .orderBy(asc(worlds.createdAt), asc(worlds.id))
      .get();
    if (!world) throw new NotFoundException('World not found');
    return world.id;
  }

  /**
   * Shared owner-scoping primitive: access control in one place. The ownership
   * predicate rides in the WHERE (a single query), so a non-Owner's row reads as
   * absent — indistinguishable from a missing one (ADR-0004).
   */
  private ownedRow(
    ownerId: string,
    id: string,
  ): typeof entities.$inferSelect | undefined {
    return this.db
      .select()
      .from(entities)
      .where(and(eq(entities.id, id), ownsEntity(ownerId)))
      .get();
  }
}

/**
 * Composable list predicates (ADR-0025). Owner-scoping applied by caller. The
 * text query `q` is handled by {@link list} (an FTS5 MATCH, ADR-0035), not here.
 * type/worldId: exact match; ids: explicit set.
 */
function filters(opts: FilterOptions) {
  const predicates = [];
  // Empty id set selects nothing (inArray([]) is always-false).
  if (opts.ids) predicates.push(inArray(entities.id, [...opts.ids]));
  // Facets (#155): OR within a category (inArray / json_each IN), AND across them
  // (separate predicates the caller ANDs). Empty arrays are skipped, not applied.
  if (opts.type?.length) predicates.push(inArray(entities.type, [...opts.type]));
  if (opts.visibility?.length)
    predicates.push(inArray(entities.visibility, [...opts.visibility]));
  if (opts.tags?.length) predicates.push(hasAnyTag(opts.tags));
  if (opts.worldId) predicates.push(eq(entities.worldId, opts.worldId));
  return predicates;
}

/**
 * The shared owner + World + query + facet conjunction for a facet-count read
 * (#155). Same predicates {@link EntitiesService.list} applies, minus paging, so a
 * count and the page it annotates always agree on what's in the filtered set.
 */
function facetWhere(ownerId: string, opts: FacetOptions, match: string | null) {
  return and(
    ownsEntity(ownerId),
    ...filters(opts),
    match ? sql`entities_fts MATCH ${match}` : undefined,
  );
}

/**
 * A row matches the Tag facet if its JSON `tags` array contains any of `tags`
 * (OR within the category, #155). `json_each` unrolls the stored array so a plain
 * `value IN (...)` can test membership; EXISTS keeps it a per-row predicate.
 */
function hasAnyTag(tags: readonly string[]) {
  const list = sql.join(
    tags.map((t) => sql`${t}`),
    sql`, `,
  );
  return sql`EXISTS (SELECT 1 FROM json_each(${entities.tags}) WHERE value IN (${list}))`;
}

/**
 * Turn a user's raw query into a safe FTS5 MATCH string (ADR-0035): split on
 * non-alphanumeric so the user can never inject FTS operators, quote each token
 * as a string literal, and append `*` for prefix matching ("cita" → "citadel").
 * Tokens combine with implicit AND. All-punctuation input yields `''`, which the
 * caller reads as "no query" (an empty MATCH string is an FTS5 error).
 */
function toFtsMatch(q: string): string {
  const tokens = q.match(/[\p{L}\p{N}]+/gu) ?? [];
  return tokens.map((t) => `"${t}"*`).join(' ');
}

function serialize(body: EntityBody): string {
  return JSON.stringify(body);
}

type SummaryRow = Omit<typeof entities.$inferSelect, 'document'>;

function toSummary(row: SummaryRow): EntitySummary {
  return {
    id: row.id,
    worldId: row.worldId,
    name: row.name,
    // Validate against schema, not bare cast (ADR-0001).
    type: entityTypeSchema.parse(row.type),
    tags: tagsSchema.parse(row.tags),
    visibility: visibilitySchema.parse(row.visibility),
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDetail(row: typeof entities.$inferSelect): EntityDetail {
  return detailOf(row, parseDocument(row.id, row.document));
}

// Write paths pass valid body; only toDetail re-parses.
function detailOf(row: SummaryRow, document: EntityBody): EntityDetail {
  return { ...toSummary(row), document, isHome: row.isHome };
}

/**
 * Parse and validate stored body (ADR-0001). Failure is corruption/migration
 * error, so throw descriptive Error naming the row (clear 500).
 */
function parseDocument(id: string, document: string): EntityBody {
  let parsed: unknown;
  try {
    parsed = JSON.parse(document);
  } catch (cause) {
    throw new Error(
      `Stored entity ${id} has a document that is not valid JSON`,
      { cause },
    );
  }
  const result = entityBodySchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Stored entity ${id} has a document that fails the Entity schema`,
      { cause: result.error },
    );
  }
  return result.data;
}
