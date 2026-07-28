import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  ApiError,
  assetThumbnailUrl,
  CreateEntityRequest,
  emptyEntityDocument,
  entityDocumentSchema,
  EntityDetail,
  EntityDocument,
  EntityErrorCode,
  EntityFacets,
  EntityRead,
  EntityReferences,
  EntitySaveOutcome,
  EntitySummary,
  EntityType,
  FacetCount,
  Field,
  FieldError,
  FieldFacet,
  FieldFilter,
  InboundReference,
  OutboundReference,
  typesSchema,
  Visibility,
  EntityGrant,
  GrantRole,
  isEntityLinkDataType,
  PublicLink,
  entityLinkConstraints,
  SaveEntityRequest,
  stripReservedKeys,
  tagsSchema,
  validateFields,
  visibilitySchema,
} from '@hexly/domain';
import { and, asc, desc, eq, inArray, or, sql, SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { IMAGE_KIND_FIELD_FILTER } from '@hexly/plugin-asset';
import { AclSetResult, gate, isSuperadmin, OwnerSetResult, removeOwnerOutcome, userExists } from '../acl/owner-set';
import { EntityAccess, entityAccess, ownsEntity, READ_ONLY_RIGHTS, sharedVisibility } from '../acl/entity-access';
import { canCreateEntityFilter, worldOwnerFilter } from '../acl/world-access';
import { mintPublicLink, PublicLinkTable, readPublicLink, revokePublicLink } from '../acl/public-link-store';
import { DB, Db } from '../db/db';
import {
  assetIndex,
  compendiums,
  containers,
  entities,
  entityDescriptors,
  entityEdges,
  entityFieldFacets,
  entityGrants,
  entityLinks,
  worlds,
} from '../db/schema';
import { HEXLY_CONFIG, HexlyConfig } from '../config';
import { AssetBytesRegistry } from './asset-bytes-registry';
import { AclWriter, EntityWrites, InsertEntityInput } from './entity-writes';
import { TypeFieldRegistry } from './type-field-registry';
import { WorldTypeFields } from './world-type-fields';
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
  /** Which kind of read this is (ADR-0079): a link-target read drops every Compendium Entry. */
  readonly read?: EntityRead;
  /** Attach the caller's Rights to each summary — opt-in, the Entity Browser sets it. */
  readonly withRights?: boolean;
  /**
   * Attach each summary's served thumbnail URL (ADR-0065) — opt-in, the Asset Browser sets it. Resolved
   * generically off the `(containerId, hash)` dedup index (a LEFT JOIN), so it names no type and other lists
   * never pay for the join.
   */
  readonly withThumbnails?: boolean;
  /**
   * Hidden-from-default-listing exclusion (ADR-0065, internal — never from the query): drop any Entity
   * carrying one of these types. The service resolves it from the registry's hidden types minus whatever
   * the caller explicitly selected, so a hidden type surfaces the moment it is selected in the type facet.
   */
  readonly excludedTypes?: readonly string[];
  /**
   * Keep hidden-from-default-listing types (ADR-0065) in the result set — opt-in, set by the by-name
   * pickers, never by a browse: the Entity Browser's search box is part of the listing, so `q` lifts nothing.
   */
  readonly includeHidden?: boolean;
}

/** The filter state a facet-count read narrows against — the list filters minus paging/ids. */
export type FacetOptions = Pick<
  ListOptions,
  'worldId' | 'read' | 'q' | 'type' | 'tags' | 'visibility' | 'fields' | 'excludedTypes' | 'includeHidden'
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
export class EntitiesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(HEXLY_CONFIG) private readonly config: HexlyConfig,
    private readonly writes: EntityWrites,
    private readonly typeFields: TypeFieldRegistry,
    private readonly worldTypeFields: WorldTypeFields,
    private readonly assetBytes: AssetBytesRegistry,
  ) {}

  /**
   * Attach the missing-bytes state to a detail (#325, ADR-0034): one indexed lookup for the byte address plus
   * one stat through the {@link AssetBytesRegistry} probe, computed per read so restoring the file clears the
   * state with no Reindex.
   */
  private withAssetBytesState(detail: EntityDetail): EntityDetail {
    const ref = this.db
      .select({ hash: assetIndex.hash, ext: assetIndex.ext })
      .from(assetIndex)
      .where(eq(assetIndex.entityId, detail.id))
      .get();
    if (!ref || !this.assetBytes.missing(detail.worldId, ref.hash, ref.ext)) return detail;
    return { ...detail, assetBytesMissing: true };
  }

  /**
   * One reader-scoped page of summaries, metadata only. Stable sort (newest first,
   * tied by id) prevents overlaps/skips; reads limit + 1 rows to detect further pages.
   */
  list(readerId: string, opts: ListOptions): ListPage {
    // A text query becomes an FTS5 MATCH ranked by bm25; absent (or
    // all-punctuation) keeps the last-edited order.
    const match = opts.q ? toFtsMatch(opts.q) : null;
    opts = { ...opts, excludedTypes: this.resolveExcludedTypes(opts) };
    const w = this.config.search.weights;
    const access = entityAccess(this.db, readerId);
    // The dedup index (ADR-0065), aliased for the two thumbnail sources it answers (ADR-0066): the Entity's
    // own bytes and the Thumbnail Field's designated target; `fieldKind` gates the latter to image Assets.
    const { ownAsset, fieldAsset, fieldKind, columns: thumbnailColumns } = thumbnailJoin();
    const query = this.db
      .select({
        id: entities.id,
        containerId: entities.containerId,
        name: entities.name,
        types: entities.types,
        tags: entities.tags,
        visibility: entities.visibility,
        version: entities.version,
        createdAt: entities.createdAt,
        updatedAt: entities.updatedAt,
        // Opt-in: project the predicate columns so each summary carries the caller's Rights.
        ...(opts.withRights ? access.rightsColumns : {}),
        // Opt-in thumbnail resolution (ADR-0065/0066): the Entity's own bytes' hash, and — beating it by
        // precedence — the hash the **Thumbnail** Field designates. Both off the same dedup index, aliased
        // twice, so a list resolves the served URL as indexed joins and other lists never pay for them.
        ...(opts.withThumbnails ? thumbnailColumns : {}),
      })
      .from(entities)
      .$dynamic();
    if (match) {
      query.innerJoin(sql`entities_fts`, sql`entities_fts.rowid = entities.rowid`);
    }
    if (opts.withThumbnails) {
      // Own bytes (ADR-0065, unchanged): the dedup index is 1:1 with an Entity (its PK is the entity id),
      // so this LEFT JOIN never multiplies rows — a bare Asset gets its hash, everything else a null.
      query.leftJoin(ownAsset, eq(ownAsset.entityId, entities.id));
      // The Thumbnail Field's designation (ADR-0066): resolve the target only when it is an **image**-kind
      // Asset (the harvested `kind` facet, ADR-0055/0065), so a non-image or dangling designation joins to
      // null and emits nothing — degrading to own bytes or the type icon, never a broken tile. The facet
      // gate rides the target-hash join, so `fieldAsset.hash` is set only for an image target with bytes.
      query.leftJoin(
        fieldKind,
        and(
          eq(fieldKind.entityId, entities.thumbnailEntityId),
          eq(fieldKind.key, IMAGE_KIND_FIELD_FILTER.key),
          eq(fieldKind.value, IMAGE_KIND_FIELD_FILTER.value),
        ),
      );
      query.leftJoin(fieldAsset, eq(fieldAsset.entityId, fieldKind.entityId));
    }
    const rows = query
      .where(and(access.filter, ...filters(opts), match ? sql`entities_fts MATCH ${match}` : undefined))
      // With a query: best match first (bm25 ascending), id for a stable page boundary;
      // otherwise newest first. Weight order must match the FTS DDL: name, tags, content_text.
      // Two tiers ride ahead of relevance, tiers rather than bm25 penalties so the order is explainable
      // rather than tuned. Compendium Entries last (ADR-0079), outermost since authored-before-published
      // outranks the Asset rule beneath it; then hidden types (ADR-0065). Only where a query ranks at
      // all — an unqueried list is `updatedAt` order, which no tier is asked to interrupt.
      .orderBy(
        ...(match
          ? [
              inACompendium(),
              ...this.hiddenLast(),
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
      let summary = toSummary(row);
      // Opt-in thumbnail with precedence (ADR-0066): the **Thumbnail** Field's designated image beats the
      // Entity's own bytes, so an Asset carrying the field emits the field's URL and a bare Asset its own; a
      // non-Asset with no designation carries none. The field target's URL keys off *its* Container (an
      // entity-link stays in-Container, so it equals the row's, but the resolved index is authoritative).
      if (opts.withThumbnails) {
        const assetRow = row as typeof row & ThumbnailRow;
        const thumbnailUrl = resolveThumbnailUrl(assetRow, row.containerId);
        if (thumbnailUrl) summary = { ...summary, thumbnailUrl };
        // The missing-bytes state (#325) rides the same opt-in, so only rows that draw imagery pay the stat.
        // Own bytes only: a broken Thumbnail designation is the designated Asset's story, not this row's.
        if (this.assetBytes.missing(row.containerId, assetRow.ownAssetHash, assetRow.ownAssetExt))
          summary = { ...summary, assetBytesMissing: true };
      }
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
    // The hidden-type exclusion (ADR-0065) rides every count *but* the type facet's: the type facet is the
    // opt-in surface, so a hidden type must still be counted over the full universe there — otherwise it
    // would never appear to be selected into view. Every sibling category resolves the exclusion exactly as
    // `list` does — via the shared helper, on the same signals — so the rail can never contradict the
    // results it annotates: a name search leaves the exclusion standing on both sides.
    const scoped: FacetOptions = { ...opts, excludedTypes: this.resolveExcludedTypes(opts) };
    return {
      // Drop a category's own selection before counting it (drill-down). No hidden-type exclusion here.
      type: this.countJsonArray({ ...opts, type: undefined, excludedTypes: [] }, entities.types, filter),
      visibility: this.countColumn({ ...scoped, visibility: undefined }, entities.visibility, filter),
      tag: this.countJsonArray({ ...scoped, tags: undefined }, entities.tags, filter),
      // Field facets by presence in the result set — no longer gated on the active Type (ADR-0054, #231).
      fields: this.countFieldFacets(scoped, filter),
    };
  }

  /**
   * Resolve the hidden-from-default-listing exclusion (ADR-0065) for a read — the single source both
   * {@link list} and {@link facets} route through, so the paged results and the Facet rail annotating them
   * can never drift. The exclusion self-lifts for a hidden type the caller selects (see
   * {@link excludedHiddenTypes}), and lifts *entirely* on two signals: `ids`, since an id lookup is no
   * listing (pins, the `/entities/:id` redirect guard), and the caller's `includeHidden`, which the by-name
   * pickers set. A name search alone lifts nothing — a browse's search box is part of its listing.
   */
  private resolveExcludedTypes(opts: Pick<FilterOptions, 'ids' | 'includeHidden' | 'type'>): string[] {
    return opts.ids || opts.includeHidden ? [] : this.excludedHiddenTypes(opts.type);
  }

  /**
   * The leading search sort key demoting hidden-from-default-listing types (ADR-0065): `EXISTS(...)` is 0
   * for an ordinary Entity and 1 for a hidden-typed one, so ascending puts ordinary first. Names no type.
   */
  private hiddenLast(): SQL[] {
    const hidden = this.typeFields.hiddenDefaultTypes;
    return hidden.length ? [sql`${hasAny(entities.types, hidden)}`] : [];
  }

  /**
   * The hidden-from-default-listing types (ADR-0065) to exclude under `selected`: every registry-declared
   * hidden type the caller did *not* explicitly select. Selecting a hidden type in the type facet drops it
   * from this set, so its Entities enter the result set — the generic opt-in, naming no type.
   */
  private excludedHiddenTypes(selected: readonly EntityType[] | undefined): string[] {
    const selectedSet = new Set(selected ?? []);
    return this.typeFields.hiddenDefaultTypes.filter((id) => !selectedSet.has(id as EntityType));
  }

  /**
   * Facetable Field facets surfaced **by presence in the result set** (ADR-0054, #231): a Field is
   * offered whenever the current browse carries entities with values for it, whatever types they hold —
   * not gated on the active Type filter (the retired ADR-0035/0048 rule). Candidate keys come off the
   * denormalised `entity_field_facets` index (which reindex already keys by document key over the
   * effective set, #226), then resolve to their Field for label/data-type.
   *
   * Both the candidate scan and the value counts drill down like the universal facets — counted against
   * every sibling constraint but the Field's own — so an actively-filtered Field stays on the rail to be
   * unselected even when its selected value matches nothing. A Field the sibling constraints leave
   * value-less is dropped.
   *
   * A **Field of a Structured Data Type** is never offered *directly* (its blob has no discrete values),
   * but its Data Type's harvested **dimensions** are a second label/control source alongside scalar
   * Fields (#235, ADR-0055): a present key resolves to a scalar Field *or* a dimension, the scalar
   * winning a shared key. Both feed the same denormalised index, so counts and drill-down are identical.
   */
  private countFieldFacets(opts: FacetOptions, filter: SQL): FieldFacet[] {
    // Discover candidates with all field filters dropped, so a Field's own selection never hides it;
    // each Field's value count then re-applies its siblings and drops it if they leave it empty.
    const candidates = new Set(this.presentFieldKeys({ ...opts, fields: [] }, filter));
    if (candidates.size === 0) return [];
    // Iterate the registry-ordered source set (scalar Fields, then harvested dimensions), not the index
    // keys, so the rail keeps a stable declaration order; a candidate key with no resolvable source (a
    // deleted World Field, ADR-0052/0054) isn't in the map, so it drops — it can't be labelled.
    const byKey = this.worldTypeFields.facetSourcesByKey(opts.worldId);
    return (
      [...byKey.values()]
        .filter((source) => candidates.has(source.key))
        .map((source): FieldFacet => {
          const values = this.countFieldValues(
            // Drill-down: drop this Field's own filters, keep every sibling constraint.
            { ...opts, fields: (opts.fields ?? []).filter((ff) => ff.key !== source.key) },
            source.key,
            filter,
          );
          return {
            key: source.key,
            label: source.label,
            // A harvested dimension carries an i18n key the rail translates; a scalar Field none (ADR-0055).
            ...(source.labelKey ? { labelKey: source.labelKey } : {}),
            // ...and a per-value key prefix, so the rail translates the dimension's values too (ADR-0055/0065).
            ...(source.valuesKeyPrefix ? { valuesKeyPrefix: source.valuesKeyPrefix } : {}),
            dataType: source.dataType,
            // An Entity-Link facet's values are target ids; resolve each to its name for the rail (#190).
            values: isEntityLinkDataType(source.dataType) ? this.labelLinkValues(values, filter) : values,
          };
        })
        // Drill-down: a Field the sibling constraints narrowed to nothing drops off the rail.
        .filter((facet) => facet.values.length > 0)
    );
  }

  /**
   * The distinct facetable-Field document keys carried by the result set under `opts` — the presence
   * signal that seeds the per-Field facets. Reads the denormalised `entity_field_facets` index; the
   * caller passes the drill-down `opts` (its own field filters dropped) so a Field's own selection can't
   * hide it. The result is a membership set; the rail's order comes from the Field registry, not here.
   */
  private presentFieldKeys(opts: FacetOptions, filter: SQL): string[] {
    const match = opts.q ? toFtsMatch(opts.q) : null;
    return this.db
      .select({ key: entityFieldFacets.key })
      .from(entities)
      .innerJoin(entityFieldFacets, eq(entityFieldFacets.entityId, entities.id))
      .where(facetWhere(opts, match, filter))
      .groupBy(entityFieldFacets.key)
      .all()
      .map((r) => r.key);
  }

  /**
   * Attach each Entity-Link facet value's target name as its `label` (#190). Filtered by the reader's
   * access to the *target* — the facet count filters on the readable source, so the target may be one
   * the reader cannot see, and an unguarded name lookup would leak a `private` Entity (ADR-0046). An
   * unreadable or deleted target keeps no label, so the rail falls back to the dangling id.
   */
  private labelLinkValues(values: readonly FacetCount[], filter: SQL): FacetCount[] {
    if (values.length === 0) return [];
    const names = new Map(
      this.db
        .select({ id: entities.id, name: entities.name })
        .from(entities)
        .where(
          and(
            filter,
            inArray(
              entities.id,
              values.map((v) => v.value),
            ),
          ),
        )
        .all()
        .map((row) => [row.id, row.name]),
    );
    return values.map((v) => (names.has(v.value) ? { ...v, label: names.get(v.value) } : v));
  }

  /**
   * Count one facetable Field's distinct values under `opts`, off the denormalised
   * `entity_field_facets` index. `(entityId, key, value)` is unique, so `count(*)` per value is the
   * number of Entities carrying it; `GROUP BY` omits zero-count values.
   */
  private countFieldValues(opts: FacetOptions, key: string, filter: SQL): FacetCount[] {
    const match = opts.q ? toFtsMatch(opts.q) : null;
    return this.db
      .select({
        value: entityFieldFacets.value,
        count: sql<number>`count(*)`.as('count'),
      })
      .from(entities)
      .innerJoin(entityFieldFacets, and(eq(entityFieldFacets.entityId, entities.id), eq(entityFieldFacets.key, key)))
      .where(facetWhere(opts, match, filter))
      .groupBy(entityFieldFacets.value)
      .orderBy(asc(entityFieldFacets.value))
      .all()
      .map((r) => ({ value: r.value, count: r.count }));
  }

  /** Count a denormalized scalar column's values (visibility) under `opts`. */
  private countColumn(opts: FacetOptions, column: typeof entities.visibility, filter: SQL): FacetCount[] {
    const match = opts.q ? toFtsMatch(opts.q) : null;
    return this.db
      .select({ value: column, count: sql<number>`count(*)`.as('count') })
      .from(entities)
      .where(facetWhere(opts, match, filter))
      .groupBy(column)
      .all()
      .map((r) => ({ value: r.value as string, count: r.count }));
  }

  /**
   * Count a multi-valued JSON-array column's values (`types`/`tags`) under `opts`. The array lives
   * in one JSON column, so `json_each` unrolls each entity's array before grouping — an entity with
   * two types (or two tags) counts toward both values.
   */
  private countJsonArray(
    opts: FacetOptions,
    column: typeof entities.types | typeof entities.tags,
    filter: SQL,
  ): FacetCount[] {
    const match = opts.q ? toFtsMatch(opts.q) : null;
    return this.db
      .select({
        value: sql<string>`each.value`.as('value'),
        count: sql<number>`count(*)`.as('count'),
      })
      .from(entities)
      .innerJoin(sql`json_each(${column}) as each`, sql`1 = 1`)
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
    return decision?.canRead
      ? this.withAssetBytesState({ ...toDetail(decision.row), rights: access.rightsOf(decision) })
      : null;
  }

  /**
   * Both directions of an Entity's links, off the derived edge index (ADR-0046). null when the
   * Entity itself is unreachable (404) — the same existence-preserving gate as {@link load}.
   *
   * The two directions have different rules. **Outbound** is ungated: a target the caller may not
   * read (or that no longer exists) resolves to `null` and renders as a dangling label. **Inbound**
   * is gated on the viewer's access to the *source*, because an edge names its source — a `private`
   * Entity linking a `shared` one would otherwise leak its name and existence to everyone who can
   * reach that `shared` one.
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
   * target.
   *
   * Asset edges surface here now (ADR-0069) — the "stored but surface-less" special case retired: an
   * `asset` edge keys on the content `hash`, so `edgeAsset` resolves it to the Asset's wrapper Entity
   * (in the edge's World) exactly as {@link inbound} resolves a viewed Asset's hash. A deleted Asset
   * leaves the edge dangling, like any unresolved target. They are decor by construction, so the
   * relation surface hides them by default and the reveal shows them.
   */
  private outbound(access: EntityAccess, id: string): OutboundReference[] {
    // Resolve each target's Thumbnail exactly as a list does (ADR-0066), so a link list reads visually.
    const { ownAsset, fieldAsset, fieldKind, columns: thumbnailColumns } = thumbnailJoin();
    // The resolver for `asset` edges: hash + World → the Asset's wrapper Entity id. Its `entityId` is
    // the target for an asset edge; an `entity` edge names its target id directly (COALESCE below).
    const edgeAsset = alias(assetIndex, 'edge_asset');
    const targetEntityId = sql`coalesce(${edgeAsset.entityId}, ${entityEdges.targetId})`;
    return (
      this.db
        .select({
          targetId: entityEdges.targetId,
          descriptor: entityEdges.descriptor,
          decor: entityEdges.decor,
          // The resolved target Entity id — equals `targetId` for an entity edge, the Asset wrapper's
          // id for an asset edge — so an asset row links to its Entity, not its opaque hash.
          id: entities.id,
          name: entities.name,
          types: entities.types,
          containerId: entities.containerId,
          ...thumbnailColumns,
        })
        .from(entityEdges)
        .leftJoin(
          edgeAsset,
          and(
            eq(entityEdges.targetKind, 'asset'),
            eq(edgeAsset.hash, entityEdges.targetId),
            eq(edgeAsset.containerId, entityEdges.containerId),
          ),
        )
        .leftJoin(entities, and(sql`${entities.id} = ${targetEntityId}`, access.filter))
        .leftJoin(ownAsset, eq(ownAsset.entityId, entities.id))
        .leftJoin(
          fieldKind,
          and(
            eq(fieldKind.entityId, entities.thumbnailEntityId),
            eq(fieldKind.key, IMAGE_KIND_FIELD_FILTER.key),
            eq(fieldKind.value, IMAGE_KIND_FIELD_FILTER.value),
          ),
        )
        .leftJoin(fieldAsset, eq(fieldAsset.entityId, fieldKind.entityId))
        .where(eq(entityEdges.sourceEntityId, id))
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
          decor: row.decor,
          // An Entity whose stored types can't be read reads as a dangling target, same as an
          // unreadable or deleted one: the reference is there, the thing at the end of it is not.
          // A resolved target carries a containerId, so the Thumbnail URL keys off *its* Container. The
          // resolved id (not the raw hash of an asset edge) is what the row links to.
          target:
            row.name === null
              ? null
              : linkedEntity(row.id, row.name, row.types, resolveThumbnailUrl(row, row.containerId ?? '')),
        }))
    );
  }

  /**
   * Who links here — the Entity's *usage*. The INNER JOIN's ON clause carries the ordinary per-viewer read
   * filter over the *source*, so an unreadable source drops the row entirely — never cached across viewers.
   *
   * For an **Asset** (ADR-0065), usage also counts the content-addressed edges Content prose and Board Image
   * elements harvest as `(targetKind: 'asset', targetId: hash)`: the harvest never resolved a hash to the
   * Asset's Entity id, so the resolution happens here, at read time — the referencing document holds the
   * capability URL, not the id, so re-uploading identical bytes (same hash) heals every reference for free
   * and deleting the Asset leaves them dangling. The hash edges are World-scoped, since identical bytes in
   * two Worlds share a hash but not an Entity.
   */
  private inbound(access: EntityAccess, id: string): InboundReference[] {
    // The Asset's content hash + World, when `id` is an Asset — its asset edges key on the hash, not the id.
    const asset = this.db
      .select({ hash: assetIndex.hash, containerId: assetIndex.containerId })
      .from(assetIndex)
      .where(eq(assetIndex.entityId, id))
      .get();
    const targets = or(
      and(eq(entityEdges.targetKind, 'entity'), eq(entityEdges.targetId, id)),
      asset
        ? and(
            eq(entityEdges.targetKind, 'asset'),
            eq(entityEdges.targetId, asset.hash),
            eq(entityEdges.containerId, asset.containerId),
          )
        : undefined,
    );
    // Resolve each source's Thumbnail exactly as a list does (ADR-0066), so usage rows read visually.
    const { ownAsset, fieldAsset, fieldKind, columns: thumbnailColumns } = thumbnailJoin();
    return (
      this.db
        .select({
          sourceId: entities.id,
          descriptor: entityEdges.descriptor,
          decor: entityEdges.decor,
          name: entities.name,
          types: entities.types,
          containerId: entities.containerId,
          ...thumbnailColumns,
        })
        .from(entityEdges)
        .innerJoin(entities, and(eq(entities.id, entityEdges.sourceEntityId), access.filter))
        .leftJoin(ownAsset, eq(ownAsset.entityId, entities.id))
        .leftJoin(
          fieldKind,
          and(
            eq(fieldKind.entityId, entities.thumbnailEntityId),
            eq(fieldKind.key, IMAGE_KIND_FIELD_FILTER.key),
            eq(fieldKind.value, IMAGE_KIND_FIELD_FILTER.value),
          ),
        )
        .leftJoin(fieldAsset, eq(fieldAsset.entityId, fieldKind.entityId))
        .where(targets)
        // `id` is the final tiebreak, for the same reason as {@link outbound}'s `targetId`.
        .orderBy(asc(entities.name), asc(entities.id), asc(entityEdges.descriptor))
        .all()
        // A source is the thing doing the linking, so unlike {@link outbound}'s target it cannot
        // dangle: a row whose source has no drawable type drops out entirely.
        .flatMap((row) => {
          const source = linkedEntity(row.sourceId, row.name, row.types, resolveThumbnailUrl(row, row.containerId));
          return source ? [{ descriptor: row.descriptor, source, decor: row.decor }] : [];
        })
    );
  }

  /**
   * Every Entity in a World, bodies included, for the vault export. Owner-scoped —
   * a member never reaches another owner's bodies.
   */
  listByWorld(userId: string, worldId: string): EntityDetail[] {
    return this.db
      .select()
      .from(entities)
      .where(and(ownsEntity(userId, this.isSuperadmin(userId)), eq(entities.containerId, worldId)))
      .all()
      .map(toDetail);
  }

  create(ownerId: string, req: CreateEntityRequest): EntityDetail {
    // The World comes first: a user-defined type's Fields resolve only within their World (#191), and the
    // minted body is the defaults the effective Field set declares (ADR-0050, ADR-0054).
    const worldId = this.resolveWorldId(ownerId, req.worldId);
    // The effective set — hence the defaults to mint — is the types' defaults plus whatever the initial
    // document already attaches (a namespaced key no type defaults, ADR-0057).
    const fields = this.worldTypeFields.effectiveFields(worldId, req.types, req.document);
    // System-managed shape guard on create (ADR-0068): the write choke point rejects a user *edit* that
    // adds a System-managed type/Field, and a raw create is that same add by another door — minting an
    // asset-typed Entity, or attaching `core.field.asset` through a crafted document key (which would forge
    // an `asset_index` dedup row). The system's own paths — mint, importers, Reindex — insert through
    // `writes.insert` directly, never this create seam, so they stay unaffected.
    if (this.createsSystemManaged(req.types, fields)) throw new ForbiddenException();
    const minted = emptyEntityDocument(fields, this.typeFields.structuredDataTypes);
    // Initial document seeds over the minted defaults. Ungated: like an import, a create establishes
    // at-rest data (the Field gate is save-only). The seed is stripped of the reserved `hexly.*`
    // namespace first: provenance is system-owned, so a create may not forge a `hexly.source` stamp
    // (ADR-0060) — only the reconcile mints it.
    const doc: EntityDocument = req.document ? { ...minted, ...stripReservedKeys(req.document) } : minted;
    const row = this.writes.insert({
      ownerId,
      containerId: worldId,
      name: req.name,
      types: req.types,
      tags: req.tags,
      document: doc,
    });
    return detailOf(row, doc);
  }

  /**
   * Whether a user create would introduce a **System-managed** type or Field (ADR-0068) — the add the write
   * choke point rejects for an edit, closed here for the create door too. The effective set already folds in
   * a document-attached Field (ADR-0057), so a crafted `core.field.asset` key is caught even when no type
   * names it. Names no type/Field of its own: it consults the registry's marker, like every other surface.
   */
  private createsSystemManaged(types: readonly EntityType[], fields: readonly Field[]): boolean {
    const systemTypes = new Set(this.typeFields.systemManagedTypes);
    if (types.some((t) => systemTypes.has(t))) return true;
    const systemFields = new Set(this.typeFields.systemManagedFields);
    return fields.some((f) => systemFields.has(f.id));
  }

  /**
   * Load an Entity as an {@link EntityDetail} by id with **no access check** — a system read for callers
   * that have already gated. The Asset mint-and-dedup returns the wrapper it just minted or deduped to
   * (ADR-0065): the dedup target may be another user's `shared` Asset, so the return is a system fact,
   * not an access-filtered read. That caller re-checks readability itself and redacts a `private` twin
   * (ADR-0046), so this stays access-free. Null when the row is gone.
   */
  detailById(id: string): EntityDetail | null {
    const row = this.db.select().from(entities).where(eq(entities.id, id)).get();
    return row ? this.withAssetBytesState(toDetail(row)) : null;
  }

  /**
   * Insert a fully-built Entity for the vault import path: document, metadata, and Type set come
   * pre-converted, and the target World is the caller's fresh import World.
   *
   * The `types` are inserted unresolved — an unregistered one still lands, and degrades to the
   * generic Field view. The Fields are unvalidated: an import establishes data at rest, and the
   * Field gate is forward-only (ADR-0048).
   */
  importEntity(input: InsertEntityInput): void {
    this.writes.insert(input);
  }

  /**
   * Version-checked save: a concurrent edit is a conflict, not a silent overwrite —
   * the base version rides the atomic WHERE. Write-gated: an unreachable Entity is
   * `not-found` (404), a reachable one the caller can't edit a 403.
   */
  save(userId: string, id: string, req: SaveEntityRequest): SaveResult {
    this.gateTypedEdit(userId, id, req);
    const result = this.writes.mutate(userId, id, {
      kind: 'edit',
      document: req.document,
      // Tags always fully replace (a save carries the full set).
      tags: req.tags,
      // Types replace only when the save carries them; omitted leaves the set untouched (ADR-0048).
      // Attachments ride the document itself now (ADR-0057), so there is no separate set to send.
      types: req.types,
      version: req.version,
    });
    switch (result.status) {
      case 'not-found':
        return { status: 'not-found' };
      case 'forbidden':
        throw new ForbiddenException();
      case 'conflict':
        return { status: 'conflict', current: this.withAssetBytesState(toDetail(result.row)) };
      case 'ok':
        // A save response replaces the client's open Entity wholesale, so it must carry the state too (#325).
        return { status: 'saved', entity: this.withAssetBytesState(detailOf(result.row, req.document)) };
    }
  }

  /**
   * The forward-only Field gate (ADR-0048, ADR-0054, ADR-0057). A save carrying an explicit `types` set is
   * an active typed edit, so its EntityDocument must fit the shape of the *effective* set — including the extras the
   * document itself attaches, so an attached Field validates even when its types never named it (story 15). A
   * save carrying no `types` is a plain body edit, left untouched, so a document at rest — or a foreign
   * import re-saved — is never retroactively invalidated.
   */
  private gateTypedEdit(userId: string, id: string, req: SaveEntityRequest): void {
    if (req.types === undefined) return;
    // Read the stored World so the effective set resolves this row's user-defined Fields. A missing row
    // 404s in `mutate` regardless.
    const stored = this.db
      .select({ containerId: entities.containerId })
      .from(entities)
      .where(eq(entities.id, id))
      .get();
    this.assertTypedFieldsValid(userId, stored?.containerId, req.types, req.document);
  }

  /**
   * Resolve the effective Field set and reject (400 {@link EntityErrorCode.InvalidFields}) on a **shape**
   * violation only (ADR-0074): an ill-typed *present* value, or an Entity-Link Field pointing at a
   * *resolvable* Entity whose types miss its target-type constraint. An absent `required` Field and a
   * missing or inaccessible link target both stay inert — never an error.
   */
  private assertTypedFieldsValid(
    userId: string,
    worldId: string | undefined,
    types: readonly EntityType[],
    metadata: EntityDocument,
  ): void {
    const fields = this.worldTypeFields.effectiveFields(worldId, types, metadata);
    // Absence is Incomplete — a state a surface flags, never a refused write (ADR-0074).
    const errors: FieldError[] = [
      ...validateFields(fields, metadata, this.typeFields.structuredDataTypes).errors,
      ...this.linkTargetTypeErrors(userId, fields, metadata),
    ];
    if (errors.length > 0)
      throw new BadRequestException({
        code: EntityErrorCode.InvalidFields,
        data: { fields: errors },
      } satisfies ApiError);
  }

  /**
   * The Entity-Link Field target-type check: flag a `type` error when a constrained link points at
   * a *resolvable* Entity whose types miss the constraint. Resolution runs through the caller's
   * read filter, so a deleted or inaccessible target resolves to no row and stays inert.
   */
  private linkTargetTypeErrors(userId: string, fields: readonly Field[], metadata: EntityDocument): FieldError[] {
    const constraints = entityLinkConstraints(fields, metadata);
    if (constraints.length === 0) return [];
    const { filter } = entityAccess(this.db, userId);
    const targetTypes = new Map(
      this.db
        .select({ id: entities.id, types: entities.types })
        .from(entities)
        .where(and(filter, inArray(entities.id, [...new Set(constraints.map((c) => c.entityId))])))
        .all()
        .map((row) => [row.id, row.types]),
    );
    return constraints.flatMap((c) => {
      const actual = targetTypes.get(c.entityId);
      // Unresolved target → inert. Resolved but off-type → a `type` error on the Field's key.
      if (!actual || actual.some((t) => c.targetTypes.includes(t))) return [];
      return [{ key: c.key, code: 'type' as const }];
    });
  }

  /**
   * EntityDocument patch: a rename (substance, so an entity-level Editor may make it) or a Visibility
   * flip (exposure, so it needs full write rights). Exactly one of the two rides a request
   * ({@link patchEntityRequestSchema}). Unreachable → null (404); reachable but not permitted → 403.
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
    return this.withAssetBytesState({
      ...toDetail(result.row),
      ...(after && { rights: access.rightsOf(after) }),
    });
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

  /**
   * Write a sharing change and surface the choke point's own refusal — `forbidden` (403), else
   * undefined to proceed (composes with `?? { status: 'ok', … }`). {@link gateOwnerManagement} is no
   * longer the last word on a `manage`: an Owner of a **Sealed** Entity is refused there (ADR-0079).
   */
  private manageRefusal(
    userId: string,
    id: string,
    acl: (w: AclWriter) => void,
  ): Extract<AclSetResult<never>, { status: 'forbidden' }> | undefined {
    const result = this.writes.mutate(userId, id, { kind: 'manage', acl });
    return result.status === 'forbidden' ? { status: 'forbidden' } : undefined;
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
    return (
      this.manageRefusal(userId, id, (w) => w.upsertOwner(targetUserId)) ?? {
        status: 'ok',
        value: this.entityOwnersOf(id),
      }
    );
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
    return this.manageRefusal(userId, id, (w) => w.removeOwner(targetUserId)) ?? outcome;
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
    return (
      this.manageRefusal(userId, id, (w) => w.upsertGrant(targetUserId, role)) ?? {
        status: 'ok',
        value: this.entityGrantsOf(id),
      }
    );
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
    return (
      this.manageRefusal(userId, id, (w) => w.removeGrant(targetUserId)) ?? {
        status: 'ok',
        value: this.entityGrantsOf(id),
      }
    );
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
    return row ? this.withAssetBytesState({ ...toDetail(row), rights: [...READ_ONLY_RIGHTS] }) : null;
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
      .where(and(eq(entities.id, id), eq(entities.containerId, worldId), sharedVisibility))
      .get();
    return row ? this.withAssetBytesState({ ...toDetail(row), rights: [...READ_ONLY_RIGHTS] }) : null;
  }

  /** Summaries of a World's `shared` Entities, ordered like {@link list}. */
  listSharedByWorld(worldId: string): EntitySummary[] {
    return this.db
      .select()
      .from(entities)
      .where(and(eq(entities.containerId, worldId), sharedVisibility))
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
    // "Oldest" is the Container's `created_at` (ADR-0078).
    const world = this.db
      .select({ id: worlds.id })
      .from(worlds)
      .innerJoin(containers, eq(containers.id, worlds.id))
      .where(predicate)
      .orderBy(asc(containers.createdAt), asc(containers.id))
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
  // Hidden-from-default-listing exclusion (ADR-0065): drop any Entity carrying an excluded type. The
  // service resolves the set (hidden types minus selected), so this predicate names no type.
  if (opts.excludedTypes?.length) predicates.push(sql`NOT ${hasAny(entities.types, opts.excludedTypes)}`);
  if (opts.visibility?.length) predicates.push(inArray(entities.visibility, [...opts.visibility]));
  if (opts.tags?.length) predicates.push(hasAny(entities.tags, opts.tags));
  if (opts.fields?.length) predicates.push(...fieldFilters(opts.fields));
  if (opts.worldId) predicates.push(eq(entities.containerId, opts.worldId));
  // The only narrowing the Compendium adds to any read (ADR-0079); it sits here so `list` and `facets`
  // share it and a picker's rail cannot count what its options exclude.
  if (opts.read === 'link-target') predicates.push(sql`NOT ${inACompendium()}`);
  return predicates;
}

/**
 * Whether the row's Container is a Compendium. Reads the `compendiums` satellite, which *is* the
 * discriminator (ADR-0078), so the predicate names no pack, no flag and no Entity Type.
 */
function inACompendium(): SQL {
  return sql`EXISTS (SELECT 1 FROM ${compendiums} WHERE ${compendiums.id} = ${entities.containerId})`;
}

/**
 * Filter-by-Field predicates (ADR-0048, #188), grouped by EntityDocument key: `eq` values OR (enum/list
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
 * for a `number` Field): a row with `num` compares numerically, one without compares its `value`
 * lexically (ISO dates sort correctly as text) — so the Field's data-type need not be known at
 * filter time. A non-finite numeric bound matches no numeric row rather than binding NaN.
 */
function rangeBound(value: string, op: '>=' | '<='): SQL {
  const n = Number(value);
  const numeric = Number.isFinite(n) ? sql`f.num ${sql.raw(op)} ${n}` : sql`0`;
  const lexical = sql`f.value ${sql.raw(op)} ${value}`;
  return sql`(CASE WHEN f.num IS NOT NULL THEN ${numeric} ELSE ${lexical} END)`;
}

/**
 * The same predicates {@link EntitiesService.list} applies, minus paging. The text query is a
 * rowid-IN subquery rather than a MATCH join: next to a positive `json_each` EXISTS predicate (a
 * Type selection) SQLite flips the join order and degrades the join's MATCH into a probe per World
 * row — seconds on a real World. The subquery pins one FTS evaluation. `list` keeps the join; its
 * bm25 ordering needs the FTS table in scope and already forces the match-first plan.
 */
function facetWhere(opts: FacetOptions, match: string | null, filter: SQL) {
  return and(
    filter,
    ...filters(opts),
    match ? sql`${entities}.rowid IN (SELECT rowid FROM entities_fts WHERE entities_fts MATCH ${match})` : undefined,
  );
}

/**
 * A row matches if its JSON-array `column` (`types` or `tags`) contains any of `values`:
 * `json_each` unrolls the stored array so `value IN (...)` tests array membership.
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

/**
 * Fresh aliases + projected columns for one Entity's Thumbnail resolution (ADR-0066) — the single
 * shape every read that shows a thumbnail joins through (`list`, and both directions of `references`),
 * so they can never drift. The dedup index (ADR-0065) is aliased twice — the Entity's own bytes and the
 * Thumbnail Field's designated image — and `fieldKind` gates the designation to an image-kind Asset. The
 * caller chains three LEFT JOINs — `ownAsset` on the subject id, `fieldKind` on the subject's
 * `thumbnailEntityId`, `fieldAsset` on the gated target — and hands each row to {@link resolveThumbnailUrl}.
 * Aliases are unique within one statement, so each method that runs its own query gets its own set.
 */
function thumbnailJoin() {
  const ownAsset = alias(assetIndex, 'own_asset');
  const fieldAsset = alias(assetIndex, 'field_asset');
  const fieldKind = alias(entityFieldFacets, 'field_kind');
  return {
    ownAsset,
    fieldAsset,
    fieldKind,
    columns: {
      ownAssetHash: ownAsset.hash,
      // `hash + ext` is the file a read stats to mark a missing Asset (#325); one join answers both.
      ownAssetExt: ownAsset.ext,
      fieldAssetHash: fieldAsset.hash,
      fieldAssetContainerId: fieldAsset.containerId,
    },
  };
}

/** The columns {@link resolveThumbnailUrl} reads off a {@link thumbnailJoin} row. */
interface ThumbnailRow {
  readonly ownAssetHash?: string | null;
  readonly ownAssetExt?: string | null;
  readonly fieldAssetHash?: string | null;
  readonly fieldAssetContainerId?: string | null;
}

/**
 * The served Thumbnail URL for one {@link thumbnailJoin} row, with precedence (ADR-0066): the Thumbnail
 * Field's designated image beats the Entity's own bytes; neither resolves → `undefined`. The field
 * target's URL keys off *its* Container (an entity-link stays in-Container, so it equals the subject's,
 * but the resolved index is authoritative); own bytes key off the subject's Container.
 */
function resolveThumbnailUrl(row: ThumbnailRow, containerId: string): string | undefined {
  if (row.fieldAssetHash) return assetThumbnailUrl(row.fieldAssetContainerId ?? containerId, row.fieldAssetHash);
  if (row.ownAssetHash) return assetThumbnailUrl(containerId, row.ownAssetHash);
  return undefined;
}

type SummaryRow = Omit<typeof entities.$inferSelect, 'document'>;

/** Exactly the columns {@link toSummary} reads, so the narrower `list` projection satisfies it. */
type SummaryColumns = Omit<SummaryRow, 'contentText' | 'seq' | 'thumbnailEntityId'>;

function toSummary(row: SummaryColumns): EntitySummary {
  return {
    id: row.id,
    // The API's `worldId` is the Entity's Container id: a World's Container id is the World's id
    // (ADR-0078), so the contract is unchanged.
    worldId: row.containerId,
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
function detailOf(row: SummaryRow, document: EntityDocument): EntityDetail {
  // `seq` rides the detail, not the summary: it is the freshness key a live-follower holds and
  // compares each incoming nudge against (ADR-0045).
  return { ...toSummary(row), seq: row.seq, document };
}

/**
 * Parse and validate the stored body. Failure is corruption — throw a descriptive
 * Error naming the row (clear 500).
 */
function parseDocument(id: string, document: string): EntityDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(document);
  } catch (cause) {
    throw new Error(`Stored entity ${id} has a document that is not valid JSON`, { cause });
  }
  const result = entityDocumentSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Stored entity ${id} has a document that fails the Entity schema`, { cause: result.error });
  }
  return result.data;
}
