import { randomUUID } from 'node:crypto';
import {
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
import { canCreateEntityFilter, worldOwnerFilter } from '../acl/world-access';
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
  worlds,
} from '../db/schema';
import { HEXLY_CONFIG, HexlyConfig } from '../config/config.module';
import { NudgeBus } from '../events/nudge-bus';

/** Per-entity Public Link table for the shared get/mint/revoke helpers. */
const ENTITY_LINK: PublicLinkTable = {
  table: entityLinks,
  id: entityLinks.id,
  fk: entityLinks.entityId,
  newRow: (token, entityId) => ({ id: token, entityId, createdAt: Date.now() }),
};

const INITIAL_VERSION = 1;

/** Reader-scoped paging + filtering options for {@link EntitiesService.list}. */
export interface ListOptions {
  readonly offset: number;
  readonly limit: number;
  /** Restrict to an explicit id set (reader-scoped); unknown ids drop out silently. */
  readonly ids?: readonly string[];
  /** Case-insensitive substring match on the name. */
  readonly q?: string;
  /** Facet: restrict to any of these Entity Types (OR within category). */
  readonly type?: readonly EntityType[];
  /** Facet: restrict to entities carrying any of these Tags (OR within category). */
  readonly tags?: readonly string[];
  /** Facet: restrict to any of these Visibilities (OR within category). */
  readonly visibility?: readonly Visibility[];
  /** Restrict to one World. */
  readonly worldId?: string;
  /** Attach the caller's Rights to each summary — opt-in, the Entity Browser sets it. */
  readonly withRights?: boolean;
}

/** The filter state a facet-count read narrows against — the list filters minus paging/ids. */
export type FacetOptions = Pick<
  ListOptions,
  'worldId' | 'q' | 'type' | 'tags' | 'visibility'
>;

/** Everything {@link filters} reads — shared by the paged list and the facet-count reads. */
type FilterOptions = FacetOptions & Pick<ListOptions, 'ids'>;

/** One page of summaries plus whether a further page exists (drives the cursor). */
export interface ListPage {
  readonly items: EntitySummary[];
  readonly hasMore: boolean;
}

/**
 * The shared {@link EntitySaveOutcome} (`saved`/`conflict`) plus an api-local
 * `not-found` arm that maps to a 404 rather than a JSON body.
 */
export type SaveResult = EntitySaveOutcome | { status: 'not-found' };

/**
 * Entity persistence: one JSON body per `entities` row. All access routes through
 * {@link entityAccess} — reads need `canRead` (owner ∨ member-and-shared),
 * mutations `canWrite` (owner ∨ world-owner-and-shared).
 */
@Injectable()
export class EntitiesService implements OnApplicationBootstrap {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(HEXLY_CONFIG) private readonly config: HexlyConfig,
    private readonly bus: NudgeBus,
  ) {}

  /**
   * Boot backfill: populate `content_text` (and, via the FTS triggers, the search
   * index) for rows where it is still NULL. No-op once every row has a value.
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
   * One reader-scoped page of summaries, metadata only. Stable sort (newest first,
   * tied by id) prevents overlaps/skips; reads limit + 1 rows to detect further pages.
   */
  list(readerId: string, opts: ListOptions): ListPage {
    // A text query becomes an FTS5 MATCH ranked by bm25; absent (or
    // all-punctuation) keeps the last-edited order.
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
        // Opt-in: project the predicate columns so each summary carries the caller's Rights.
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
      // With a query: best match first (bm25 ascending), id for a stable page boundary;
      // otherwise newest first. Weight order must match the FTS DDL: name, tags, content_text.
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
   * Facet-count read for the Facet rail: each category is counted under the other
   * active constraints but *not* its own, so drilling into one category still lists
   * the sibling values you could add. `GROUP BY` omits zero-count values.
   * Reader- and World-scoped like {@link list}.
   */
  facets(readerId: string, opts: FacetOptions): EntityFacets {
    // Resolve the read filter (Superadmin bypass folded in) once, reuse it in every count.
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
   * `json_each` unrolls each array before grouping — an entity with two tags
   * counts toward both values.
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
   * exist, so ownership never leaks.
   */
  load(userId: string, id: string): EntityDetail | null {
    const access = entityAccess(this.db, userId);
    const decision = access.decide(id);
    // Rights let the editor gate itself: a Viewer opens read-only, an entity-level
    // Editor (canWrite false, canEditSubstance true) opens writable. canManage rides
    // the owner-only gate so the Share dialog is only offered to actual Owners.
    return decision?.canRead
      ? { ...toDetail(decision.row), rights: access.rightsOf(decision) }
      : null;
  }

  /**
   * Every Entity in a World, bodies included, for the vault export. Owner-scoped —
   * a member never reaches another owner's bodies. Pulls the full `document` column.
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
    return detailOf(row, body);
  }

  /**
   * Insert a fully-built Entity for the vault import path: body and metadata come
   * pre-converted, and the target World is the caller's fresh import World.
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
   * The single INSERT trunk {@link create} and {@link importNote} share. Returns
   * the inserted row so callers can build an {@link EntityDetail} without a re-read.
   */
  private insertEntity(input: {
    /** Pre-generated id — the import path assigns ids up front to resolve wikilinks before insert. */
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
      // Search index text; the FTS triggers pick it up from the column.
      contentText: extractText(input.body.content),
      createdAt: now,
      updatedAt: now,
    };
    // Row and its initial Owner land together — a new Entity is never ownerless.
    this.db.transaction(() => {
      this.db.insert(entities).values(row).run();
      this.db.insert(entityGrants).values({ entityId: row.id, userId: input.ownerId, role: 'owner' }).run();
    });
    return row;
  }

  /**
   * Version-checked save: a concurrent edit is a conflict, not a silent overwrite —
   * the base version rides the atomic WHERE. Write-gated: an unreachable Entity is
   * `not-found` (404), a reachable one the caller can't edit a 403.
   */
  save(userId: string, id: string, req: SaveEntityRequest): SaveResult {
    // Read first for not-found and to preserve untouched columns in response.
    const access = entityAccess(this.db, userId);
    const decision = access.decide(id);
    if (!decision?.canRead) return { status: 'not-found' };
    // An entity-level Editor may save Content/Tags too.
    if (!decision.canEditSubstance) throw new ForbiddenException();
    const row = decision.row;

    // Set only columns a save owns so concurrent renames aren't clobbered.
    // Tags always fully replace (save carries the full set).
    const document = serialize(req.document);
    const contentText = extractText(req.document.content);
    // Descriptors are derived from the saved Content, not sent by the client.
    const descriptors = descriptorsSchema.parse(harvestDescriptors(req.document.content));
    const version = req.version + 1;
    const updatedAt = Date.now();
    // Body write and descriptor-index replace in one transaction so the index
    // always reflects the last successful save, never a rejected one.
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
    // Nudge followers only after the atomic write lands.
    this.bus.emitEntityChange(id, version, updatedAt);
    return {
      status: 'saved',
      entity: detailOf(
        { ...row, version, updatedAt, tags: req.tags },
        req.document,
      ),
    };
  }

  /**
   * Metadata patch (`name` and/or Visibility): no version bump, so it never
   * invalidates an in-progress edit. Write-gated: unreachable → null (404),
   * reachable but not writable → 403.
   */
  patch(
    userId: string,
    id: string,
    changes: { name?: string; visibility?: Visibility },
  ): EntityDetail | null {
    const access = entityAccess(this.db, userId);
    const decision = access.decide(id);
    if (!decision?.canRead) return null;
    // Visibility is exposure, never a grant power: changing it needs full write
    // rights, while a name-only patch is substance an entity-level Editor may make.
    // The WHERE below mirrors whichever gate applies.
    const changesVisibility = changes.visibility !== undefined;
    const permitted = changesVisibility ? decision.canWrite : decision.canEditSubstance;
    if (!permitted) throw new ForbiddenException();
    const updatedAt = Date.now();
    const res = this.db
      .update(entities)
      // The gate predicate in the WHERE (not ownsEntity) so a World Owner's or an
      // Editor's write lands; evaluated pre-SET, so a shared→private re-hide still matches.
      .set({ ...changes, updatedAt })
      .where(
        and(
          eq(entities.id, id),
          changesVisibility ? access.writeFilter : access.editFilter,
        ),
      )
      .run();
    // 0 rows means the write predicate no longer matched between the access read and
    // this UPDATE (e.g. concurrently flipped `private`): the write never landed, so
    // return null (404), not a fake 200.
    if (res.changes === 0) return null;
    // A patch never bumps version — the fresh `updatedAt` marks the nudge newer
    // than what a follower holds.
    this.bus.emitEntityChange(id, decision.row.version, updatedAt);
    // A visibility flip can change the caller's own standing (a World Owner loses
    // write when a shared Entity goes private), so recompute Rights post-update.
    // Cold path — never the autosave hot path.
    const after = access.decide(id);
    return {
      ...toDetail({ ...decision.row, ...changes, updatedAt }),
      ...(after && { rights: access.rightsOf(after) }),
    };
  }

  /**
   * Owner's `::` suggestion vocabulary: DISTINCT Link Descriptors across their
   * entities. Reflects last-saved state (reads the index, not edits).
   */
  listDescriptors(ownerId: string): string[] {
    return this.db
      .selectDistinct({ descriptor: entityDescriptors.descriptor })
      .from(entityDescriptors)
      .innerJoin(entities, eq(entities.id, entityDescriptors.entityId))
      // Personal suggestion vocabulary — the caller's own descriptors; no Superadmin bypass.
      .where(ownsEntity(ownerId, false))
      .orderBy(asc(entityDescriptors.descriptor))
      .all()
      .map((row) => row.descriptor);
  }

  /**
   * Owner's tag suggestion vocabulary: DISTINCT Tags across their entities.
   * `json_each` unrolls the JSON `tags` column before DISTINCT.
   */
  listTags(ownerId: string): string[] {
    return this.db
      .selectDistinct({ value: sql<string>`tag.value` })
      .from(entities)
      .innerJoin(sql`json_each(${entities.tags}) as tag`, sql`1 = 1`)
      // Personal suggestion vocabulary — the caller's own tags only; no Superadmin bypass.
      .where(ownsEntity(ownerId, false))
      .orderBy(sql`tag.value`)
      .all()
      .map((row) => row.value);
  }

  /**
   * Replace the entity's descriptor rows with the harvested set (self-pruning).
   * Runs inside save's transaction.
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
   * Delete an Entity: an Owner, or the World Owner of a `shared` one. false →
   * unreachable (404); reachable but not writable → 403.
   */
  delete(userId: string, id: string): boolean {
    const access = entityAccess(this.db, userId).decide(id);
    if (!access?.canRead) return false;
    if (!access.canWrite) throw new ForbiddenException();
    // entity_grants (owner + grant rows) cascades with the row.
    this.db.delete(entities).where(eq(entities.id, id)).run();
    // Deletion is eviction: the bus resolves every follower to `unavailable`.
    this.bus.emitEntityChange(id, access.row.version, access.row.updatedAt);
    return true;
  }

  /**
   * Gate the owner-set endpoints: grant/owner management belongs to the Entity's
   * Owners *alone* — not the World Owner, even over a `shared` Entity. Returns the
   * failing outcome (`not-found` → 404, `forbidden` → 403) or undefined to proceed.
   */
  private gateOwnerManagement(
    userId: string,
    id: string,
  ): Extract<OwnerSetResult, { status: 'not-found' | 'forbidden' }> | undefined {
    // Only needs reachability + ownership, so it uses the blob-free decideMeta.
    const meta = entityAccess(this.db, userId).decideMeta(id);
    return gate({ reachable: !!meta?.canRead, isOwner: !!meta?.isOwner });
  }

  /** The Entity's ownership set, for an Owner. Unreachable → 404; not an Owner → 403. */
  listOwners(userId: string, id: string): OwnerSetResult {
    const gate = this.gateOwnerManagement(userId, id);
    if (gate) return gate;
    return { status: 'ok', value: this.entityOwnersOf(id) };
  }

  /**
   * Add a co-Owner: Owner-only, the target must be an existing Instance user.
   * Idempotent — re-adding an existing Owner is a no-op returning the set.
   */
  addOwner(userId: string, id: string, targetUserId: string): OwnerSetResult {
    const gate = this.gateOwnerManagement(userId, id);
    if (gate) return gate;
    if (!userExists(this.db, targetUserId)) return { status: 'no-such-user' };
    // Owner wins: promoting a user who holds an editor/viewer grant overwrites it to owner.
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
   * Remove an Owner (or resign your own ownership): Owner-only. The ≥1-Owner
   * invariant refuses removing the last Owner (`last-owner` → 409). A co-Owner may
   * evict any other Owner, including the creator.
   */
  removeOwner(userId: string, id: string, targetUserId: string): OwnerSetResult {
    const gate = this.gateOwnerManagement(userId, id);
    if (gate) return gate;
    const outcome = removeOwnerOutcome(this.entityOwnersOf(id), targetUserId);
    if (outcome.status !== 'ok') return outcome;
    // Delete the owner-role row — their access ends; they hold no other grant row.
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

  /** The Entity's grant set, for an Owner — same Owner-only gate as the owner set. */
  listGrants(userId: string, id: string): AclSetResult<EntityGrant[]> {
    const gate = this.gateOwnerManagement(userId, id);
    return gate ?? { status: 'ok', value: this.entityGrantsOf(id) };
  }

  /**
   * Grant an Instance user Editor or Viewer: Owner-only; World membership is *not*
   * required. Upsert — re-granting a different role updates it.
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
    // The `setWhere` guard makes an existing `owner` row win, so granting a current
    // Owner viewer/editor never demotes them past the ≥1-Owner invariant. Owners are
    // managed via addOwner/removeOwner only.
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
   * Revoke a grant: Owner-only. Revoking a non-existent grant is a no-op that
   * still returns the (unchanged) set.
   */
  removeGrant(
    userId: string,
    id: string,
    targetUserId: string,
  ): AclSetResult<EntityGrant[]> {
    const gate = this.gateOwnerManagement(userId, id);
    if (gate) return gate;
    // Editor/viewer rows only — an `owner` row is removed via removeOwner (which
    // enforces the ≥1-Owner invariant), never silently deleted here.
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

  /** The Entity's Public Link (active token or null), for an Owner — same Owner-only gate as grants. */
  getLink(userId: string, id: string): AclSetResult<PublicLink | null> {
    const gate = this.gateOwnerManagement(userId, id);
    if (gate) return gate;
    return { status: 'ok', value: readPublicLink(this.db, ENTITY_LINK, id) };
  }

  /**
   * Mint (or return the existing) Public Link: Owner-only, one active link per
   * Entity — a re-mint returns the current token (rotate = revoke + re-mint). The
   * token is an anonymous Viewer grant that pierces `private`.
   */
  mintLink(userId: string, id: string): AclSetResult<PublicLink> {
    const gate = this.gateOwnerManagement(userId, id);
    if (gate) return gate;
    return { status: 'ok', value: mintPublicLink(this.db, ENTITY_LINK, id) };
  }

  /**
   * Revoke the Public Link: Owner-only kill-switch — the token stops resolving
   * immediately. Idempotent.
   */
  revokeLink(userId: string, id: string): AclSetResult<null> {
    const gate = this.gateOwnerManagement(userId, id);
    if (gate) return gate;
    revokePublicLink(this.db, ENTITY_LINK, id);
    // Revoke is eviction: emit with the row's real version/updatedAt so an anonymous
    // token follower resolves to `unavailable` while a still-authorized follower
    // computes newer-than-held false and no-ops.
    const row = this.db
      .select({ version: entities.version, updatedAt: entities.updatedAt })
      .from(entities)
      .where(eq(entities.id, id))
      .get();
    if (row) this.bus.emitEntityChange(id, row.version, row.updatedAt);
    return { status: 'ok', value: null };
  }

  /**
   * Resolve a Public Link token to its Entity, read-only. The token *is* an
   * anonymous Viewer grant, so it pierces `private` — no visibility check. null
   * when the token doesn't resolve (revoked or never minted).
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
   * The `shared` Entity in World `worldId` with this id, read-only — the per-entity
   * read behind a World Public Link. Scoped to the token's World *and* `shared`, so
   * the link reaches that World's shared surface and nothing else; anything else is null (404).
   */
  loadSharedInWorld(worldId: string, id: string): EntityDetail | null {
    const row = this.db
      .select()
      .from(entities)
      .where(and(eq(entities.id, id), eq(entities.worldId, worldId), sharedVisibility))
      .get();
    return row ? { ...toDetail(row), rights: [...READ_ONLY_RIGHTS] } : null;
  }

  /** Summaries of a World's `shared` Entities, ordered like {@link list}. */
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
   * The Entity's grants, ordered by user id. Owner rows share the table but aren't
   * grants — the grant surface is editor/viewer only ({@link entityOwnersOf} covers owners).
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

  /** The Entity's Owner user ids — the `owner`-role rows, ordered stably. */
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
   * Resolve the target World for a new Entity. A supplied worldId may be any World
   * the caller can author in (Owner, Contributor, or Superadmin). An absent one
   * defaults to the caller's own oldest *owned* World — never a World they merely
   * contribute to, nor (for a Superadmin) the globally-oldest World.
   */
  private resolveWorldId(ownerId: string, requestedId?: string): string {
    const predicate = requestedId
      ? and(eq(worlds.id, requestedId), canCreateEntityFilter(ownerId, this.isSuperadmin(ownerId)))
      : worldOwnerFilter(ownerId);
    const world = this.db
      .select({ id: worlds.id })
      .from(worlds)
      .where(predicate)
      .orderBy(asc(worlds.createdAt), asc(worlds.id))
      .get();
    if (!world)
      throw new NotFoundException({ code: EntityErrorCode.NoWritableWorld } satisfies ApiError);
    return world.id;
  }

  /** The Superadmin repair bypass, for ownership-only scans that don't route through an access context. */
  private isSuperadmin(userId: string): boolean {
    return isSuperadmin(this.db, userId);
  }
}

/**
 * Composable list predicates. Owner-scoping and the FTS text query are applied by
 * the caller.
 */
function filters(opts: FilterOptions) {
  const predicates = [];
  // Empty id set selects nothing (inArray([]) is always-false).
  if (opts.ids) predicates.push(inArray(entities.id, [...opts.ids]));
  // Facets: OR within a category, AND across them; empty arrays are skipped.
  if (opts.type?.length) predicates.push(inArray(entities.type, [...opts.type]));
  if (opts.visibility?.length)
    predicates.push(inArray(entities.visibility, [...opts.visibility]));
  if (opts.tags?.length) predicates.push(hasAnyTag(opts.tags));
  if (opts.worldId) predicates.push(eq(entities.worldId, opts.worldId));
  return predicates;
}

/**
 * The same predicates {@link EntitiesService.list} applies, minus paging, so a
 * facet count and the page it annotates always agree on the filtered set.
 */
function facetWhere(opts: FacetOptions, match: string | null, filter: SQL) {
  return and(
    filter,
    ...filters(opts),
    match ? sql`entities_fts MATCH ${match}` : undefined,
  );
}

/**
 * A row matches if its JSON `tags` array contains any of `tags`: `json_each`
 * unrolls the stored array so `value IN (...)` can test membership.
 */
function hasAnyTag(tags: readonly string[]) {
  const list = sql.join(
    tags.map((t) => sql`${t}`),
    sql`, `,
  );
  return sql`EXISTS (SELECT 1 FROM json_each(${entities.tags}) WHERE value IN (${list}))`;
}

/**
 * Turn a raw query into a safe FTS5 MATCH string: split on non-alphanumeric (so
 * FTS operators can't be injected), quote each token, append `*` for prefix match.
 * All-punctuation input yields `''`, which the caller reads as "no query" (an
 * empty MATCH string is an FTS5 error).
 */
function toFtsMatch(q: string): string {
  const tokens = q.match(/[\p{L}\p{N}]+/gu) ?? [];
  return tokens.map((t) => `"${t}"*`).join(' ');
}

function serialize(body: EntityBody): string {
  return JSON.stringify(body);
}

type SummaryRow = Omit<typeof entities.$inferSelect, 'document'>;

/** Exactly the columns {@link toSummary} reads — narrower than {@link SummaryRow}, so the `list` projection (which skips `contentText` for weight) satisfies it. */
type SummaryColumns = Omit<SummaryRow, 'contentText'>;

function toSummary(row: SummaryColumns): EntitySummary {
  return {
    id: row.id,
    worldId: row.worldId,
    name: row.name,
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
  return { ...toSummary(row), document };
}

/**
 * Parse and validate the stored body. Failure is corruption — throw a descriptive
 * Error naming the row (clear 500).
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
