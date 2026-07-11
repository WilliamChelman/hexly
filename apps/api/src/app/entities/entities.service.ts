import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  ApiError,
  CORE_NOTE,
  CreateEntityRequest,
  emptyEntityBody,
  EntityBody,
  entityBodySchema,
  EntityDetail,
  EntityErrorCode,
  EntityFacets,
  EntityReferences,
  EntitySaveOutcome,
  EntitySummary,
  EntityType,
  FacetCount,
  FieldFacet,
  FieldFilter,
  InboundReference,
  OutboundReference,
  typesSchema,
  Visibility,
  EntityGrant,
  GrantRole,
  PublicLink,
  resolveFields,
  SaveEntityRequest,
  tagsSchema,
  validateFields,
  visibilitySchema,
} from '@hexly/domain';
import { and, asc, desc, eq, inArray, sql, SQL } from 'drizzle-orm';
import { AclSetResult, gate, isSuperadmin, OwnerSetResult, removeOwnerOutcome, userExists } from '../acl/owner-set';
import { EntityAccess, entityAccess, ownsEntity, READ_ONLY_RIGHTS, sharedVisibility } from '../acl/entity-access';
import { canCreateEntityFilter, worldOwnerFilter } from '../acl/world-access';
import { mintPublicLink, PublicLinkTable, readPublicLink, revokePublicLink } from '../acl/public-link-store';
import { DB, Db } from '../db/db';
import {
  entities,
  entityDescriptors,
  entityEdges,
  entityFieldFacets,
  entityGrants,
  entityLinks,
  worlds,
} from '../db/schema';
import { HEXLY_CONFIG, HexlyConfig } from '../config/config.module';
import { EntityWrites } from './entity-writes';
import { TypeFieldRegistry } from './type-field-registry';
import { linkedEntity } from './utils/linked-entity';

/** Per-entity Public Link table for the shared get/mint/revoke helpers. */
const ENTITY_LINK: PublicLinkTable = {
  table: entityLinks,
  id: entityLinks.id,
  fk: entityLinks.entityId,
  newRow: (token, entityId) => ({ id: token, entityId, createdAt: Date.now() }),
};

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
  /** Filter-by-Field (ADR-0048, #188): each constraint matches a facetable Field value — eq
   * membership (enum/list/string) or a gte/lte range (number/date). Same key OR / range, diff key AND. */
  readonly fields?: readonly FieldFilter[];
  /** Restrict to one World. */
  readonly worldId?: string;
  /** Attach the caller's Rights to each summary — opt-in, the Entity Browser sets it. */
  readonly withRights?: boolean;
}

/** The filter state a facet-count read narrows against — the list filters minus paging/ids. */
export type FacetOptions = Pick<ListOptions, 'worldId' | 'q' | 'type' | 'tags' | 'visibility' | 'fields'>;

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
export class EntitiesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(HEXLY_CONFIG) private readonly config: HexlyConfig,
    private readonly writes: EntityWrites,
    private readonly typeFields: TypeFieldRegistry,
  ) {}

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
        types: entities.types,
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
      .where(and(access.filter, ...filters(opts), match ? sql`entities_fts MATCH ${match}` : undefined))
      // With a query: best match first (bm25 ascending), id for a stable page boundary;
      // otherwise newest first. Weight order must match the FTS DDL: name, tags, content_text.
      .orderBy(
        ...(match
          ? [sql`bm25(entities_fts, ${w.name}, ${w.tags}, ${w.content})`, asc(entities.id)]
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
      type: this.countJsonArray({ ...opts, type: undefined }, entities.types, filter),
      visibility: this.countColumn({ ...opts, visibility: undefined }, entities.visibility, filter),
      tag: this.countJsonArray({ ...opts, tags: undefined }, entities.tags, filter),
      // A type's Field facets, contextually — only the active types' facetable Fields (ADR-0048, #188).
      fields: this.countFieldFacets(opts, filter),
    };
  }

  /**
   * A type's facetable Field facets, surfaced **contextually** (ADR-0048, #188): resolved across the
   * *active* Type filter (`opts.type`), so a Field facet is absent until its type is the active
   * filter, and the universal facets are unaffected. Each Field's values drill down like the
   * universal facets — counted against every other constraint but that Field's own filter.
   */
  private countFieldFacets(opts: FacetOptions, filter: SQL): FieldFacet[] {
    const fields = resolveFields(this.typeFields.resolver, opts.type ?? []).filter((field) => field.facetable);
    return fields.map((field) => ({
      key: field.key,
      label: field.label,
      dataType: field.dataType,
      values: this.countFieldValues(
        // Drill-down: drop this Field's own filters, keep every sibling constraint.
        {
          ...opts,
          fields: (opts.fields ?? []).filter((ff) => ff.key !== field.key),
        },
        field.key,
        filter,
      ),
    }));
  }

  /**
   * Count one facetable Field's distinct values under `opts`, off the denormalised
   * `entity_field_facets` index. `(entityId, key, value)` is unique, so `count(*)` per value is the
   * number of Entities carrying it; `GROUP BY` omits zero-count values, exactly like the universal
   * facets.
   */
  private countFieldValues(opts: FacetOptions, key: string, filter: SQL): FacetCount[] {
    const match = opts.q ? toFtsMatch(opts.q) : null;
    const query = this.db
      .select({
        value: entityFieldFacets.value,
        count: sql<number>`count(*)`.as('count'),
      })
      .from(entities)
      .innerJoin(entityFieldFacets, and(eq(entityFieldFacets.entityId, entities.id), eq(entityFieldFacets.key, key)))
      .$dynamic();
    if (match) {
      query.innerJoin(sql`entities_fts`, sql`entities_fts.rowid = entities.rowid`);
    }
    return query
      .where(facetWhere(opts, match, filter))
      .groupBy(entityFieldFacets.value)
      .orderBy(asc(entityFieldFacets.value))
      .all()
      .map((r) => ({ value: r.value, count: r.count }));
  }

  /** Count a denormalized scalar column's values (visibility) under `opts`. */
  private countColumn(opts: FacetOptions, column: typeof entities.visibility, filter: SQL): FacetCount[] {
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
   * Count a multi-valued JSON-array column's values (`types`/`tags`) under `opts`. The array lives
   * in one JSON column, so `json_each` unrolls each entity's array before grouping — an entity with
   * two types (or two tags) counts toward both values. This is the multi-valued path the Type facet
   * moved onto when `type` became the `types` set (ADR-0048), shared with the Tag facet it mirrors.
   */
  private countJsonArray(
    opts: FacetOptions,
    column: typeof entities.types | typeof entities.tags,
    filter: SQL,
  ): FacetCount[] {
    const match = opts.q ? toFtsMatch(opts.q) : null;
    const query = this.db
      .select({
        value: sql<string>`each.value`.as('value'),
        count: sql<number>`count(*)`.as('count'),
      })
      .from(entities)
      .innerJoin(sql`json_each(${column}) as each`, sql`1 = 1`)
      .$dynamic();
    if (match) {
      query.innerJoin(sql`entities_fts`, sql`entities_fts.rowid = entities.rowid`);
    }
    return query
      .where(facetWhere(opts, match, filter))
      .groupBy(sql`each.value`)
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
    return decision?.canRead ? { ...toDetail(decision.row), rights: access.rightsOf(decision) } : null;
  }

  /**
   * Both directions of an Entity's links, off the derived edge index (ADR-0046). null when the
   * Entity itself is unreachable (404) — the same existence-preserving gate as {@link load}.
   *
   * The two directions have deliberately different rules. **Outbound** needs no hiding: the caller
   * already reads this Entity, and a target it may not read (or that no longer exists) resolves to
   * `null` and renders as a dangling label. **Inbound** is gated on the viewer's access to the
   * *source*, because an edge names its source — so a `private` Entity linking a `shared` one would
   * otherwise leak its name and existence to everyone who can reach that `shared` one.
   */
  references(userId: string, id: string): EntityReferences | null {
    const access = entityAccess(this.db, userId);
    if (!access.decideMeta(id)?.canRead) return null;
    return {
      references: this.outbound(access, id),
      referencedBy: this.inbound(access, id),
    };
  }

  /**
   * This Entity's links. A LEFT JOIN under the read filter resolves each target's *current* name;
   * a target that is deleted, or that the viewer cannot read, yields NULL columns and so a `null`
   * target. Asset edges are stored but surface-less, so `entity` targets alone are selected.
   */
  private outbound(access: EntityAccess, id: string): OutboundReference[] {
    return (
      this.db
        .select({
          targetId: entityEdges.targetId,
          descriptor: entityEdges.descriptor,
          name: entities.name,
          types: entities.types,
        })
        .from(entityEdges)
        .leftJoin(entities, and(eq(entities.id, entityEdges.targetId), access.filter))
        .where(and(eq(entityEdges.sourceEntityId, id), eq(entityEdges.targetKind, 'entity')))
        // Resolved targets by name; the dangling ones last, where they read as a footnote. `targetId`
        // is the final tiebreak, so two Entities sharing a name — or two descriptors to one target —
        // hold a stable order between reads (as `list` does with `asc(entities.id)`).
        .orderBy(
          sql`${entities.name} IS NULL`,
          asc(entities.name),
          asc(entityEdges.targetId),
          asc(entityEdges.descriptor),
        )
        .all()
        .map((row) => ({
          targetId: row.targetId,
          descriptor: row.descriptor,
          // An Entity whose stored types can't be read reads as a dangling target, same as an
          // unreadable or deleted one: the reference is there, the thing at the end of it is not.
          target: row.name === null ? null : linkedEntity(row.targetId, row.name, row.types),
        }))
    );
  }

  /**
   * Who links here. The INNER JOIN's ON clause carries the ordinary per-viewer read filter over
   * the *source*, so an unreadable source drops the row entirely — never cached across viewers.
   */
  private inbound(access: EntityAccess, id: string): InboundReference[] {
    return (
      this.db
        .select({
          sourceId: entities.id,
          descriptor: entityEdges.descriptor,
          name: entities.name,
          types: entities.types,
        })
        .from(entityEdges)
        .innerJoin(entities, and(eq(entities.id, entityEdges.sourceEntityId), access.filter))
        .where(and(eq(entityEdges.targetKind, 'entity'), eq(entityEdges.targetId, id)))
        // `id` is the final tiebreak, for the same reason as {@link outbound}'s `targetId`.
        .orderBy(asc(entities.name), asc(entities.id), asc(entityEdges.descriptor))
        .all()
        // A source is the thing doing the linking, so unlike {@link outbound}'s target it cannot
        // dangle: a row whose source has no drawable type drops out entirely.
        .flatMap((row) => {
          const source = linkedEntity(row.sourceId, row.name, row.types);
          return source ? [{ descriptor: row.descriptor, source }] : [];
        })
    );
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
    // Seed the minted body with the create dialog's initial Metadata (a picked type's required Field
    // values). Not gated: like import, a create establishes at-rest data — the gate is save-only
    // (#187), and the create dialog runs the forward-only check client-side before it sends.
    const body = req.metadata ? { ...emptyEntityBody(req.types), metadata: req.metadata } : emptyEntityBody(req.types);
    const row = this.writes.insert({
      ownerId,
      worldId: this.resolveWorldId(ownerId, req.worldId),
      name: req.name,
      types: req.types,
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
    // An imported note is always a single `core.note` — multi-type authoring is not an import path.
    this.writes.insert({
      id,
      ownerId,
      worldId,
      name,
      tags,
      types: [CORE_NOTE],
      body,
    });
  }

  /**
   * Version-checked save: a concurrent edit is a conflict, not a silent overwrite —
   * the base version rides the atomic WHERE. Write-gated: an unreachable Entity is
   * `not-found` (404), a reachable one the caller can't edit a 403.
   */
  save(userId: string, id: string, req: SaveEntityRequest): SaveResult {
    this.gateTypedEdit(req);
    const result = this.writes.mutate(userId, id, {
      kind: 'edit',
      document: req.document,
      // Tags always fully replace (a save carries the full set).
      tags: req.tags,
      // Types replace only when the save carries them; the current client omits them (ADR-0048).
      types: req.types,
      version: req.version,
    });
    switch (result.status) {
      case 'not-found':
        return { status: 'not-found' };
      case 'forbidden':
        throw new ForbiddenException();
      case 'conflict':
        return { status: 'conflict', current: toDetail(result.row) };
      case 'ok':
        return { status: 'saved', entity: detailOf(result.row, req.document) };
    }
  }

  /**
   * The forward-only Field gate on the write path (ADR-0048). A save that carries an explicit
   * `types` set is an **active typed edit** — the generic Field view (or a plugin form) asserting
   * the Entity's type set — so its Metadata must satisfy those types' Fields: every required Field
   * present, every present value well-typed. A save that omits `types` is a plain body edit and is
   * left untouched, so an already-stored (or imported) document with malformed Fields is never
   * *retroactively* invalidated by an unrelated edit — the gate only bites data the caller actively
   * types. The vault import ({@link importNote}) never routes here, and reads / reindex never
   * validate, so data at rest stays tolerated end to end.
   */
  private gateTypedEdit(req: SaveEntityRequest): void {
    if (req.types === undefined) return;
    this.assertTypedFieldsValid(req.types, req.document.metadata);
  }

  /**
   * Resolve `types` to their Fields and reject (400 {@link EntityErrorCode.InvalidFields}) when the
   * Metadata leaves a required Field unmet or ill-types a present one — the forward-only check
   * {@link gateTypedEdit} runs for a typed save.
   */
  private assertTypedFieldsValid(types: readonly EntityType[], metadata: EntityBody['metadata']): void {
    const fields = resolveFields(this.typeFields.resolver, types);
    const validation = validateFields(fields, metadata);
    if (!validation.ok)
      throw new BadRequestException({
        code: EntityErrorCode.InvalidFields,
        data: { fields: validation.errors },
      } satisfies ApiError);
  }

  /**
   * Metadata patch: a rename (substance, so an entity-level Editor may make it) or a Visibility
   * flip (exposure, so it needs full write rights). Exactly one of the two rides a request
   * ({@link patchEntityRequestSchema}), which is what lets the kind name the change and the kind
   * pick the gate. Unreachable → null (404); reachable but not permitted → 403.
   */
  patch(userId: string, id: string, changes: { name?: string; visibility?: Visibility }): EntityDetail | null {
    const result = this.writes.mutate(
      userId,
      id,
      changes.visibility !== undefined
        ? { kind: 'set-visibility', visibility: changes.visibility }
        : { kind: 'edit', name: changes.name },
    );
    if (result.status === 'forbidden') throw new ForbiddenException();
    // `conflict` is unreachable — a patch carries no base version — but `not-found` also covers
    // the write predicate ceasing to match mid-flight, which must 404 rather than fake a 200.
    if (result.status !== 'ok') return null;
    // A visibility flip can change the caller's own standing (a World Owner loses write when a
    // shared Entity goes private), so recompute Rights post-update. Cold path.
    const access = entityAccess(this.db, userId);
    const after = access.decide(id);
    return {
      ...toDetail(result.row),
      ...(after && { rights: access.rightsOf(after) }),
    };
  }

  /**
   * Owner's `::` suggestion vocabulary: DISTINCT Link Descriptors across their
   * entities. Reflects last-saved state (reads the index, not edits).
   */
  listDescriptors(ownerId: string): string[] {
    return (
      this.db
        .selectDistinct({ descriptor: entityDescriptors.descriptor })
        .from(entityDescriptors)
        .innerJoin(entities, eq(entities.id, entityDescriptors.entityId))
        // Personal suggestion vocabulary — the caller's own descriptors; no Superadmin bypass.
        .where(ownsEntity(ownerId, false))
        .orderBy(asc(entityDescriptors.descriptor))
        .all()
        .map((row) => row.descriptor)
    );
  }

  /**
   * Owner's tag suggestion vocabulary: DISTINCT Tags across their entities.
   * `json_each` unrolls the JSON `tags` column before DISTINCT.
   */
  listTags(ownerId: string): string[] {
    return (
      this.db
        .selectDistinct({ value: sql<string>`tag.value` })
        .from(entities)
        .innerJoin(sql`json_each(${entities.tags}) as tag`, sql`1 = 1`)
        // Personal suggestion vocabulary — the caller's own tags only; no Superadmin bypass.
        .where(ownsEntity(ownerId, false))
        .orderBy(sql`tag.value`)
        .all()
        .map((row) => row.value)
    );
  }

  /**
   * Delete an Entity: an Owner, or the World Owner of a `shared` one. false →
   * unreachable (404); reachable but not writable → 403.
   */
  delete(userId: string, id: string): boolean {
    // Deletion is eviction: the row is gone, so the bus resolves every follower to `unavailable`.
    const result = this.writes.mutate(userId, id, { kind: 'delete' });
    if (result.status === 'forbidden') throw new ForbiddenException();
    return result.status === 'ok';
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
    // Promotion grants `manage`, so a follower already holding this Entity must refetch —
    // hence the additive path nudges too, not just removals.
    this.writes.mutate(userId, id, {
      kind: 'manage',
      acl: (w) => w.upsertOwner(targetUserId),
    });
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
    // Delete the owner-role row — their access ends; they hold no other grant row. The nudge
    // evicts them live; every remaining Owner refetches their (unchanged) Rights.
    this.writes.mutate(userId, id, {
      kind: 'manage',
      acl: (w) => w.removeOwner(targetUserId),
    });
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
  addGrant(userId: string, id: string, targetUserId: string, role: GrantRole): AclSetResult<EntityGrant[]> {
    const gate = this.gateOwnerManagement(userId, id);
    if (gate) return gate;
    if (!userExists(this.db, targetUserId)) return { status: 'no-such-user' };
    // An Editor demoted to Viewer must see their Save button vanish: `rights` ride the resource
    // (ADR-0039), so only a nudge-driven refetch refreshes them.
    this.writes.mutate(userId, id, {
      kind: 'manage',
      acl: (w) => w.upsertGrant(targetUserId, role),
    });
    return { status: 'ok', value: this.entityGrantsOf(id) };
  }

  /**
   * Revoke a grant: Owner-only. Revoking a non-existent grant is a no-op that
   * still returns the (unchanged) set.
   */
  removeGrant(userId: string, id: string, targetUserId: string): AclSetResult<EntityGrant[]> {
    const gate = this.gateOwnerManagement(userId, id);
    if (gate) return gate;
    // Editor/viewer rows only — an `owner` row is removed via removeOwner (which enforces the
    // ≥1-Owner invariant), never silently deleted here. Revocation is how entity-level access
    // ends, so the nudge evicts a live-following grantee rather than leaving them on a stale view.
    this.writes.mutate(userId, id, {
      kind: 'manage',
      acl: (w) => w.removeGrant(targetUserId),
    });
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
    // Link revocation is sharing, so it is a `manage` write: the token row and the `seq` bump
    // land in one transaction, and the nudge flushes after it. An anonymous token follower then
    // resolves to `unavailable`; a still-authorized follower simply refetches.
    this.writes.transact(() => {
      revokePublicLink(this.db, ENTITY_LINK, id);
      return this.writes.mutate(userId, id, { kind: 'manage' });
    });
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
      throw new NotFoundException({
        code: EntityErrorCode.NoWritableWorld,
      } satisfies ApiError);
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
  if (opts.type?.length) predicates.push(hasAny(entities.types, opts.type));
  if (opts.visibility?.length) predicates.push(inArray(entities.visibility, [...opts.visibility]));
  if (opts.tags?.length) predicates.push(hasAny(entities.tags, opts.tags));
  if (opts.fields?.length) predicates.push(...fieldFilters(opts.fields));
  if (opts.worldId) predicates.push(eq(entities.worldId, opts.worldId));
  return predicates;
}

/**
 * Filter-by-Field predicates (ADR-0048, #188), grouped by Metadata key: `eq` values OR (enum/list
 * membership), `gte`/`lte` bounds AND (a range), and one `EXISTS` over the denormalised
 * `entity_field_facets` index per key — so different keys AND, matching the universal facets. A
 * range on a `number` Field compares the numeric `num` column; a date/string compares `value`
 * lexically (ISO dates sort correctly as text).
 */
function fieldFilters(fields: readonly FieldFilter[]): SQL[] {
  const byKey = new Map<string, FieldFilter[]>();
  for (const f of fields) {
    const group = byKey.get(f.key);
    if (group) group.push(f);
    else byKey.set(f.key, [f]);
  }
  const predicates: SQL[] = [];
  for (const [key, group] of byKey) {
    const conds: SQL[] = [];
    const eqValues = group.filter((f) => f.op === 'eq').map((f) => f.value);
    if (eqValues.length) {
      const list = sql.join(
        eqValues.map((v) => sql`${v}`),
        sql`, `,
      );
      conds.push(sql`f.value IN (${list})`);
    }
    for (const f of group) {
      if (f.op === 'gte') conds.push(rangeBound(f.value, '>='));
      if (f.op === 'lte') conds.push(rangeBound(f.value, '<='));
    }
    if (conds.length === 0) continue;
    predicates.push(
      sql`EXISTS (SELECT 1 FROM ${entityFieldFacets} f WHERE f.entity_id = ${entities.id} AND f.key = ${key} AND ${and(...conds)})`,
    );
  }
  return predicates;
}

/**
 * One `gte`/`lte` range bound. The materialised `num` column *is* the numeric-ness signal (set only
 * for a `number` Field), so a row with `num` compares numerically and one without compares its
 * `value` lexically (ISO dates sort correctly as text) — no need to know the Field's data-type at
 * filter time, so a stale URL that omits the active type still compares a number as a number. A
 * non-finite numeric bound (a hand-edited URL) matches no numeric row rather than binding NaN.
 */
function rangeBound(value: string, op: '>=' | '<='): SQL {
  const n = Number(value);
  const numeric = Number.isFinite(n) ? sql`f.num ${sql.raw(op)} ${n}` : sql`0`;
  const lexical = sql`f.value ${sql.raw(op)} ${value}`;
  return sql`(CASE WHEN f.num IS NOT NULL THEN ${numeric} ELSE ${lexical} END)`;
}

/**
 * The same predicates {@link EntitiesService.list} applies, minus paging, so a
 * facet count and the page it annotates always agree on the filtered set.
 */
function facetWhere(opts: FacetOptions, match: string | null, filter: SQL) {
  return and(filter, ...filters(opts), match ? sql`entities_fts MATCH ${match}` : undefined);
}

/**
 * A row matches if its JSON-array `column` (`types` or `tags`) contains any of `values`:
 * `json_each` unrolls the stored array so `value IN (...)` tests array membership. Shared by the
 * Type and Tag filters, both multi-valued since the `type` → `types` flip (ADR-0048).
 */
function hasAny(column: typeof entities.types | typeof entities.tags, values: readonly string[]) {
  const list = sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );
  return sql`EXISTS (SELECT 1 FROM json_each(${column}) WHERE value IN (${list}))`;
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

type SummaryRow = Omit<typeof entities.$inferSelect, 'document'>;

/**
 * Exactly the columns {@link toSummary} reads — narrower than {@link SummaryRow}, so the `list`
 * projection (which skips `contentText` for weight, and `seq` because a summary carries no
 * freshness key — only the detail a follower holds does) satisfies it.
 */
type SummaryColumns = Omit<SummaryRow, 'contentText' | 'seq'>;

function toSummary(row: SummaryColumns): EntitySummary {
  return {
    id: row.id,
    worldId: row.worldId,
    name: row.name,
    types: typesSchema.parse(row.types),
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
  // `seq` rides the detail, not the summary: it is the freshness key a live-follower holds and
  // compares each incoming nudge against (ADR-0045).
  return { ...toSummary(row), seq: row.seq, document };
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
    throw new Error(`Stored entity ${id} has a document that is not valid JSON`, { cause });
  }
  const result = entityBodySchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Stored entity ${id} has a document that fails the Entity schema`, { cause: result.error });
  }
  return result.data;
}
