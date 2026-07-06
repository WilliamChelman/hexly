import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import {
  ApiError,
  CreateEntityRequest,
  emptyEntityBody,
  EntityBody,
  entityBodySchema,
  EntityDetail,
  EntityErrorCode,
  EntityFacets,
  EntitySaveOutcome,
  EntitySummary,
  EntityType,
  FacetCount,
  entityTypeSchema,
  extractText,
  Visibility,
  descriptorsSchema,
  EntityGrant,
  GrantRole,
  harvestDescriptors,
  PublicLink,
  SaveEntityRequest,
  tagsSchema,
  visibilitySchema,
} from '@hexly/domain';
import { and, asc, desc, eq, inArray, isNull, ne, sql, SQL } from 'drizzle-orm';
import {
  AclSetResult,
  gate,
  isSuperadmin,
  OwnerSetResult,
  removeOwnerOutcome,
  userExists,
} from '../acl/owner-set';
import {
  entityAccess,
  ownsEntity,
  READ_ONLY_RIGHTS,
  sharedVisibility,
} from '../acl/entity-access';
import {
  mintPublicLink,
  PublicLinkTable,
  readPublicLink,
  revokePublicLink,
} from '../acl/public-link-store';
import { DB, Db } from '../db/db';
import {
  entities,
  entityDescriptors,
  entityGrants,
  entityLinks,
  worldMembers,
  worlds,
} from '../db/schema';
import { HEXLY_CONFIG, HexlyConfig } from '../config/config.module';

/** The per-entity Public Link table for the shared get/mint/revoke helpers (ADR-0037, #162). */
const ENTITY_LINK: PublicLinkTable = {
  table: entityLinks,
  id: entityLinks.id,
  fk: entityLinks.entityId,
  newRow: (token, entityId) => ({ id: token, entityId, createdAt: Date.now() }),
};

const INITIAL_VERSION = 1;

/** Reader-scoped paging + filtering options for {@link EntitiesService.list} (ADR-0025, ADR-0037). */
export interface ListOptions {
  readonly offset: number;
  readonly limit: number;
  /** Restrict to an explicit id set (reader-scoped); unknown ids drop out silently. */
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
  /** Attach the caller's Rights to each summary (ADR-0039) — opt-in, the Entity Browser sets it. */
  readonly withRights?: boolean;
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
 * Entity persistence: one JSON body per `entities` row (ADR-0018, ADR-0002). Access
 * routes through the read/write predicate (ADR-0037): a read needs `canRead` (owner ∨
 * member-and-shared), a mutation `canWrite` (owner ∨ world-owner-and-shared) — the choke
 * point is {@link access}. Body serialization and `version` bookkeeping live here.
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
   * One reader-scoped page of summaries (ADR-0025, ADR-0037), metadata only. Stable sort
   * (newest first, tied by id) prevents overlaps/skips. Reads limit + 1 rows
   * to detect further pages without phantom empty page.
   */
  list(readerId: string, opts: ListOptions): ListPage {
    // A text query becomes an FTS5 MATCH (ADR-0035): full-text over name, tags,
    // and Content prose, ranked by bm25. Absent (or all-punctuation) → keep the
    // last-edited order. Skip potentially large document column.
    const match = opts.q ? toFtsMatch(opts.q) : null;
    const w = this.config.search.weights;
    const access = entityAccess(this.db, readerId);
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
        // Opt-in per-row Rights (ADR-0039): project the same predicate columns the decision
        // does so each summary can carry the caller's verbs. Omitted → pure read-filter.
        ...(opts.withRights ? access.rightsColumns : {}),
      })
      .from(entities)
      .$dynamic();
    if (match) {
      query.innerJoin(sql`entities_fts`, sql`entities_fts.rowid = entities.rowid`);
    }
    const rows = query
      .where(
        and(
          access.filter,
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
    const items = rows.slice(0, opts.limit).map((row) => {
      const summary = toSummary(row);
      if (!opts.withRights) return summary;
      // The predicate columns arrive as SQLite 0/1; rightsOf reads them truthily.
      const r = row as typeof row & Record<'canRead' | 'canEditSubstance' | 'canWrite' | 'isOwner', unknown>;
      return {
        ...summary,
        rights: access.rightsOf({
          canRead: !!r.canRead,
          canEditSubstance: !!r.canEditSubstance,
          canWrite: !!r.canWrite,
          isOwner: !!r.isOwner,
        }),
      };
    });
    return { items, hasMore };
  }

  /**
   * Facet-count read for the Facet rail (#155). For each category, count its
   * distinct values under the *other* active constraints (query + the other
   * Facets) but **not** its own — so drilling into one category still lists the
   * sibling values you could add, each narrowed by everything else. `GROUP BY`
   * naturally omits zero-count values (a value with no rows never appears).
   * Reader- and World-scoped like {@link list}.
   */
  facets(readerId: string, opts: FacetOptions): EntityFacets {
    // Resolve the read filter once (Superadmin bypass folded in), then reuse it in every count.
    const { filter } = entityAccess(this.db, readerId);
    return {
      // Drop a category's own selection before counting it (drill-down).
      type: this.countColumn({ ...opts, type: undefined }, entities.type, filter),
      visibility: this.countColumn(
        { ...opts, visibility: undefined },
        entities.visibility,
        filter,
      ),
      tag: this.countTags({ ...opts, tags: undefined }, filter),
    };
  }

  /** Count a denormalized column's values (type/visibility) under `opts`. */
  private countColumn(
    opts: FacetOptions,
    column: typeof entities.type | typeof entities.visibility,
    filter: SQL,
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
      .where(facetWhere(opts, match, filter))
      .groupBy(column)
      .all()
      .map((r) => ({ value: r.value as string, count: r.count }));
  }

  /**
   * Count Tag-facet values under `opts`. Tags live in the JSON `tags` column, so
   * `json_each` unrolls each entity's array into rows before grouping — an entity
   * with two tags counts toward both values (ADR-0035, #155).
   */
  private countTags(opts: FacetOptions, filter: SQL): FacetCount[] {
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
      .where(facetWhere(opts, match, filter))
      .groupBy(sql`tag.value`)
      .all()
      .map((r) => ({ value: r.value, count: r.count }));
  }

  /**
   * An Entity owned by someone else is indistinguishable from one that does not
   * exist, so ownership never leaks (ADR-0004).
   */
  load(userId: string, id: string): EntityDetail | null {
    const access = entityAccess(this.db, userId);
    const decision = access.decide(id);
    // Surface substance-write power so the editor gates itself (ADR-0037): a read-only
    // member or a Viewer grant opens read-only rather than autosaving into a wall of 403s,
    // while an entity-level Editor (canWrite false, canEditSubstance true) opens writable.
    // canManage rides the owner-only gate so the Share dialog (owners/grants/link — all
    // owner-only) is only offered to someone who can actually use it, not every writer.
    return decision?.canRead
      ? { ...toDetail(decision.row), rights: access.rightsOf(decision) }
      : null;
  }

  /**
   * Every Entity in a World, bodies included, for the vault export (ADR-0033, #150).
   * Owner-scoped like the rest of the service — a member never reaches another owner's
   * bodies. Unlike {@link list} this pulls the full `document` column (export serializes it).
   */
  listByWorld(userId: string, worldId: string): EntityDetail[] {
    return this.db
      .select()
      .from(entities)
      .where(and(ownsEntity(userId, this.isSuperadmin(userId)), eq(entities.worldId, worldId)))
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
      // The importer minted this World, so they are its Home Owner — no bypass needed.
      .where(and(eq(entities.id, homeEntityId), ownsEntity(ownerId, false)))
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
    // never ownerless. The creator is the initial sole member of its owner set, an
    // `owner`-role grant row (migration 0007).
    this.db.transaction(() => {
      this.db.insert(entities).values(row).run();
      this.db.insert(entityGrants).values({ entityId: row.id, userId: input.ownerId, role: 'owner' }).run();
    });
    return row;
  }

  /**
   * Version-checked save (ADR-0018, ADR-0004). Concurrent edit is a conflict, not silent
   * overwrite — the base version rides the atomic WHERE. Write-gated through {@link access}
   * (ADR-0037): an Owner or the World Owner of a `shared` Entity may edit its substance; an
   * unreachable Entity is a 404 (`not-found`), a reachable one the caller can't write a 403.
   */
  save(userId: string, id: string, req: SaveEntityRequest): SaveResult {
    // Read first for not-found and to preserve untouched columns in response.
    const access = entityAccess(this.db, userId);
    const decision = access.decide(id);
    if (!decision?.canRead) return { status: 'not-found' };
    // Substance edit (ADR-0037, #161): an entity-level Editor may save Content/Tags too.
    if (!decision.canEditSubstance) throw new ForbiddenException();
    const row = decision.row;

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
            access.editFilter,
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
      const current = access.decide(id);
      return current?.canRead
        ? { status: 'conflict', current: toDetail(current.row) }
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
   * A metadata patch (ADR-0037): the `name` and/or the Visibility, no version bump — it
   * leaves the body and version untouched so it never invalidates an in-progress edit.
   * Write-gated through {@link access}: an unreachable Entity is a 404 (null), a reachable
   * one the caller can't write a 403. The Home Entity is locked `shared` (like its title
   * and undeletability), so a visibility change away from `shared` on it is refused (409).
   */
  patch(
    userId: string,
    id: string,
    changes: { name?: string; visibility?: Visibility },
  ): EntityDetail | null {
    const access = entityAccess(this.db, userId);
    const decision = access.decide(id);
    if (!decision?.canRead) return null;
    // Visibility is exposure — never a grant power (ADR-0037, #161), so a visibility
    // change needs full management rights; a name-only patch is substance, which an
    // entity-level Editor may make. The WHERE below mirrors whichever gate applies.
    const changesVisibility = changes.visibility !== undefined;
    const permitted = changesVisibility ? decision.canWrite : decision.canEditSubstance;
    if (!permitted) throw new ForbiddenException();
    if (decision.row.isHome && changes.visibility && changes.visibility !== 'shared') {
      // 409, like delete: conflicts with the World invariant that a shared World keeps a landing page.
      throw new ConflictException({ code: EntityErrorCode.HomeLockedShared } satisfies ApiError);
    }
    const updatedAt = Date.now();
    const res = this.db
      .update(entities)
      // The gate predicate in the WHERE (not ownsEntity) so a World Owner's — or an
      // Editor's name — write actually lands; evaluated pre-SET, so a shared→private
      // re-hide still matches.
      .set({ ...changes, updatedAt })
      .where(
        and(
          eq(entities.id, id),
          changesVisibility ? access.writeFilter : access.editFilter,
        ),
      )
      .run();
    // 0 rows means the write predicate no longer matched between the access read and this
    // UPDATE (e.g. the row was concurrently flipped `private`): the write never landed, so
    // don't fake a 200. Mirror save()'s lost-write arm — an unreachable row is `null` (404).
    if (res.changes === 0) return null;
    // A visibility flip changes the *caller's own* standing (a World Owner loses write, hence
    // read+edit, when a shared Entity goes private — ADR-0037): the one metadata patch where the
    // load-time Rights the client carries forward go stale. Recompute post-update and ship them
    // so the editor reflects the caller's real standing instead of a stale writable state (a
    // name-only patch leaves standing untouched, so this is a no-op there). Cold path — a
    // rename/visibility toggle, never the autosave hot path — so the extra access read is fine.
    const after = access.decide(id);
    return {
      ...toDetail({ ...decision.row, ...changes, updatedAt }),
      ...(after && { rights: access.rightsOf(after) }),
    };
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
      // A personal suggestion vocabulary — the caller's *own* descriptors, so no
      // Superadmin bypass (repair reaches content, not another user's autocomplete).
      .where(ownsEntity(ownerId, false))
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
      // Personal suggestion vocabulary — the caller's own tags; no Superadmin bypass.
      .where(ownsEntity(ownerId, false))
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

  /**
   * Delete an Entity (ADR-0037): an Owner, or the World Owner of a `shared` one (the
   * nuclear revoke) — write-gated through {@link access}. false → unreachable (404); a
   * reachable Entity the caller can't write is a 403. The Home Entity is undeletable (409).
   */
  delete(userId: string, id: string): boolean {
    const access = entityAccess(this.db, userId).decide(id);
    if (!access?.canRead) return false;
    if (!access.canWrite) throw new ForbiddenException();
    // 409, not 400: conflicts with World invariant (Home Entity always exists, ADR-0024).
    if (access.row.isHome)
      throw new ConflictException({ code: EntityErrorCode.HomeUndeletable } satisfies ApiError);
    // entity_grants (owner + grant rows) cascades with the row.
    this.db.delete(entities).where(eq(entities.id, id)).run();
    return true;
  }

  /**
   * Gate the owner-set endpoints (ADR-0037): grant/owner management belongs to the Entity's
   * Owners *alone* — not the World Owner, even over a `shared` Entity (grants pierce `private`
   * and outlive visibility flips, so they stay with the accountable party). Returns the failing
   * outcome — `not-found` when the Entity is unreachable (404), `forbidden` when it is reachable
   * but the caller isn't an Owner (403) — or undefined when the caller is an Owner and may proceed.
   */
  private gateOwnerManagement(
    userId: string,
    id: string,
  ): Extract<OwnerSetResult, { status: 'not-found' | 'forbidden' }> | undefined {
    // Only needs reachability + ownership, so it uses the blob-free decideMeta (no document),
    // then the shared gate maps it to the not-found/forbidden/proceed split (ADR-0037).
    const meta = entityAccess(this.db, userId).decideMeta(id);
    return gate({ reachable: !!meta?.canRead, isOwner: !!meta?.isOwner });
  }

  /**
   * The Entity's ownership set, for an Owner (ADR-0037). Unreachable → 404; reachable but
   * not an Owner → 403 (the controller maps the outcome via {@link gateOwnerManagement}).
   */
  listOwners(userId: string, id: string): OwnerSetResult {
    const gate = this.gateOwnerManagement(userId, id);
    if (gate) return gate;
    return { status: 'ok', value: this.entityOwnersOf(id) };
  }

  /**
   * Add a co-Owner to an Entity (ADR-0037): Owner-only, the target must be an existing
   * Instance user. Idempotent — re-adding an existing Owner is a no-op returning the set.
   */
  addOwner(userId: string, id: string, targetUserId: string): OwnerSetResult {
    const gate = this.gateOwnerManagement(userId, id);
    if (gate) return gate;
    if (!userExists(this.db, targetUserId)) return { status: 'no-such-user' };
    // Owner wins (ADR-0037, migration 0007): promoting a user who already holds an
    // editor/viewer grant overwrites it to owner; re-adding an existing Owner is a no-op.
    this.db
      .insert(entityGrants)
      .values({ entityId: id, userId: targetUserId, role: 'owner' })
      .onConflictDoUpdate({
        target: [entityGrants.entityId, entityGrants.userId],
        set: { role: 'owner' },
      })
      .run();
    return { status: 'ok', value: this.entityOwnersOf(id) };
  }

  /**
   * Remove an Owner from an Entity, or resign your own ownership (ADR-0037): Owner-only.
   * The ≥1-Owner invariant refuses removing the last Owner (`last-owner` → 409). A
   * co-Owner may evict any other Owner, including the creator.
   */
  removeOwner(userId: string, id: string, targetUserId: string): OwnerSetResult {
    const gate = this.gateOwnerManagement(userId, id);
    if (gate) return gate;
    const outcome = removeOwnerOutcome(this.entityOwnersOf(id), targetUserId);
    if (outcome.status !== 'ok') return outcome;
    // Delete the owner-role row (their access ends; they hold no other row post-fold).
    this.db
      .delete(entityGrants)
      .where(
        and(
          eq(entityGrants.entityId, id),
          eq(entityGrants.userId, targetUserId),
          eq(entityGrants.role, 'owner'),
        ),
      )
      .run();
    return outcome;
  }

  /**
   * The Entity's grant set, for an Owner (ADR-0037, #161). Grant management belongs to
   * the Owners alone (same gate as the owner set) — unreachable → 404, reachable but not
   * an Owner → 403 (the controller maps the outcome).
   */
  listGrants(userId: string, id: string): AclSetResult<EntityGrant[]> {
    const gate = this.gateOwnerManagement(userId, id);
    return gate ?? { status: 'ok', value: this.entityGrantsOf(id) };
  }

  /**
   * Grant an Instance user Editor or Viewer on an Entity (ADR-0037, #161): Owner-only,
   * the target must be an existing Instance user (World membership is *not* required —
   * an outsider can be handed one note). Upsert — re-granting a different role updates it.
   */
  addGrant(
    userId: string,
    id: string,
    targetUserId: string,
    role: GrantRole,
  ): AclSetResult<EntityGrant[]> {
    const gate = this.gateOwnerManagement(userId, id);
    if (gate) return gate;
    if (!userExists(this.db, targetUserId)) return { status: 'no-such-user' };
    // A grant is editor/viewer only — the `setWhere` guard makes an existing `owner` row win,
    // so granting a current Owner viewer/editor never demotes them (that would silently strip
    // ownership through the wrong endpoint, past the ≥1-Owner invariant). Owners are managed
    // via addOwner/removeOwner; the grant surface (entityGrantsOf) excludes them.
    this.db
      .insert(entityGrants)
      .values({ entityId: id, userId: targetUserId, role })
      .onConflictDoUpdate({
        target: [entityGrants.entityId, entityGrants.userId],
        set: { role },
        setWhere: ne(entityGrants.role, 'owner'),
      })
      .run();
    return { status: 'ok', value: this.entityGrantsOf(id) };
  }

  /**
   * Revoke a grant (ADR-0037, #161): Owner-only. Revocation is how entity-level access
   * ends — a plain row delete, after which the read/write predicates simply recompute.
   * Revoking a non-existent grant is a no-op that still returns the (unchanged) set.
   */
  removeGrant(
    userId: string,
    id: string,
    targetUserId: string,
  ): AclSetResult<EntityGrant[]> {
    const gate = this.gateOwnerManagement(userId, id);
    if (gate) return gate;
    // Editor/viewer rows only — an `owner` row is removed via removeOwner (which enforces the
    // ≥1-Owner invariant), never silently deleted here through the grant-revoke endpoint.
    this.db
      .delete(entityGrants)
      .where(
        and(
          eq(entityGrants.entityId, id),
          eq(entityGrants.userId, targetUserId),
          inArray(entityGrants.role, ['editor', 'viewer']),
        ),
      )
      .run();
    return { status: 'ok', value: this.entityGrantsOf(id) };
  }

  /**
   * The Entity's per-entity Public Link, for an Owner (ADR-0037, #162): the active token or
   * null. Link administration belongs to the Entity's Owners alone (same gate as grants) —
   * unreachable → 404, reachable but not an Owner → 403 (the controller maps the outcome).
   */
  getLink(userId: string, id: string): AclSetResult<PublicLink | null> {
    const gate = this.gateOwnerManagement(userId, id);
    if (gate) return gate;
    return { status: 'ok', value: readPublicLink(this.db, ENTITY_LINK, id) };
  }

  /**
   * Mint (or return the existing) per-entity Public Link (ADR-0037, #162): Owner-only. One
   * active link per Entity — a re-mint returns the current token rather than rotating it, so
   * the shared URL stays stable (rotate = revoke + re-mint). The token is an anonymous Viewer
   * grant that pierces `private`; revoking it is the kill-switch (ADR-0004).
   */
  mintLink(userId: string, id: string): AclSetResult<PublicLink> {
    const gate = this.gateOwnerManagement(userId, id);
    if (gate) return gate;
    return { status: 'ok', value: mintPublicLink(this.db, ENTITY_LINK, id) };
  }

  /**
   * Revoke the per-entity Public Link (ADR-0037, #162): Owner-only, the kill-switch. A plain
   * row delete after which the token route stops resolving immediately. Idempotent — revoking
   * an absent link is a no-op that still succeeds.
   */
  revokeLink(userId: string, id: string): AclSetResult<null> {
    const gate = this.gateOwnerManagement(userId, id);
    if (gate) return gate;
    revokePublicLink(this.db, ENTITY_LINK, id);
    return { status: 'ok', value: null };
  }

  /**
   * Resolve a per-entity Public Link token to its Entity, read-only (ADR-0037, #162). The
   * token *is* an anonymous Viewer grant, so it pierces `private` — no visibility check. null
   * when the token doesn't resolve (revoked or never minted). `canWrite: false` so the reader
   * renders read-only.
   */
  loadByEntityLink(token: string): EntityDetail | null {
    const link = this.db
      .select({ entityId: entityLinks.entityId })
      .from(entityLinks)
      .where(eq(entityLinks.id, token))
      .get();
    if (!link) return null;
    const row = this.db.select().from(entities).where(eq(entities.id, link.entityId)).get();
    return row ? { ...toDetail(row), rights: [...READ_ONLY_RIGHTS] } : null;
  }

  /**
   * The `shared` Entity in World `worldId` with this id, read-only (ADR-0037, #162) — the
   * per-entity read behind a World Public Link. Scoped to the token's World *and* `shared`,
   * so the World link reaches that World's shared surface and nothing else; a `private` or
   * out-of-World id is null (→ 404, a non-navigable dangling label for the reader).
   */
  loadSharedInWorld(worldId: string, id: string): EntityDetail | null {
    const row = this.db
      .select()
      .from(entities)
      .where(and(eq(entities.id, id), eq(entities.worldId, worldId), sharedVisibility))
      .get();
    return row ? { ...toDetail(row), rights: [...READ_ONLY_RIGHTS] } : null;
  }

  /** Summaries of a World's `shared` Entities (ADR-0037, #162), ordered like {@link list}. */
  listSharedByWorld(worldId: string): EntitySummary[] {
    return this.db
      .select()
      .from(entities)
      .where(and(eq(entities.worldId, worldId), sharedVisibility))
      .orderBy(desc(entities.updatedAt), asc(entities.id))
      .all()
      .map(toSummary);
  }

  /**
   * The Entity's grants (ADR-0037, #161), ordered stably by user id. Owner rows share the
   * table post-fold (migration 0007) but aren't grants — the grant surface is editor/viewer
   * only, so they're filtered out here (owners are the {@link entityOwnersOf} surface).
   */
  private entityGrantsOf(id: string): EntityGrant[] {
    return this.db
      .select({ userId: entityGrants.userId, role: entityGrants.role })
      .from(entityGrants)
      .where(and(eq(entityGrants.entityId, id), inArray(entityGrants.role, ['editor', 'viewer'])))
      .orderBy(asc(entityGrants.userId))
      .all()
      .map((r) => ({ userId: r.userId, role: r.role as GrantRole }));
  }

  /** The Entity's Owner user ids (ADR-0037) — the `owner`-role rows, ordered stably. */
  private entityOwnersOf(id: string): string[] {
    return this.db
      .select({ userId: entityGrants.userId })
      .from(entityGrants)
      .where(and(eq(entityGrants.entityId, id), eq(entityGrants.role, 'owner')))
      .orderBy(asc(entityGrants.userId))
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
    if (!world)
      throw new NotFoundException({ code: EntityErrorCode.NoWritableWorld } satisfies ApiError);
    return world.id;
  }

  /**
   * Whether `userId` is a Superadmin (ADR-0037, #163) — the repair bypass, for the
   * ownership-only scans ({@link listByWorld}) that don't route through an access context.
   */
  private isSuperadmin(userId: string): boolean {
    return isSuperadmin(this.db, userId);
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
function facetWhere(opts: FacetOptions, match: string | null, filter: SQL) {
  return and(
    filter,
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

/** Exactly the columns {@link toSummary} reads — narrower than {@link SummaryRow}, so the `list` projection (which skips `isHome`/`contentText` for weight) satisfies it. */
type SummaryColumns = Omit<SummaryRow, 'isHome' | 'contentText'>;

function toSummary(row: SummaryColumns): EntitySummary {
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
