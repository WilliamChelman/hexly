import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  DocumentDerivedState,
  EntityEdge,
  FieldFacetValue,
  GrantRole,
  EntityDocument,
  ImportSource,
  ReindexFailure,
  Visibility,
  deriveDocumentState,
  reservedKeys,
  stripReservedKeys,
} from '@hexly/domain';
import { CORE_THUMBNAIL_FIELD_ID } from '@hexly/plugin-asset';
import { and, asc, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import { EntityAccess, entityAccess, sharedVisibility } from '../acl/entity-access';
import { DB, Db } from '../db/db';
import {
  INITIAL_SEQ,
  assetIndex,
  entities,
  entityDescriptors,
  entityEdges,
  entityFieldFacets,
  entityGrants,
  entityImportSource,
} from '../db/schema';
import { SyncOnly, WriteOutbox } from '../events/write-outbox';
import { EntityDeletionRegistry } from './entity-deletion-registry';
import { TypeFieldRegistry } from './type-field-registry';
import { WorldTypeFields } from './world-type-fields';

/** A fresh Entity starts at version 1 — the optimistic-concurrency token's floor. */
const INITIAL_VERSION = 1;

/**
 * SQLite's `SQLITE_MAX_VARIABLE_NUMBER` — the most bound parameters one statement may carry. A
 * multi-row `VALUES` list binds `rows × columns` of them, so a derived index rebuilt in one
 * statement hard-fails past `limit / columns` rows with "too many SQL variables", rolling the
 * save back and leaving the document unsavable. {@link batched} keeps each statement under it.
 */
const MAX_BOUND_PARAMS = 32766;

/** Columns bound per `entity_edges` row: source, world, kind, target, descriptor. */
const EDGE_COLUMNS = 5;
/** Columns bound per `entity_descriptors` row: entity, descriptor. */
const DESCRIPTOR_COLUMNS = 2;
/** Columns bound per `entity_field_facets` row: entity, world, key, value, num. */
const FIELD_FACET_COLUMNS = 5;

/** Split `rows` into the largest batches a single `INSERT … VALUES` can bind. Empty in, nothing out. */
function* batched<T>(rows: readonly T[], columns: number): Generator<readonly T[]> {
  const size = Math.floor(MAX_BOUND_PARAMS / columns);
  for (let i = 0; i < rows.length; i += size) yield rows.slice(i, i + size);
}

/**
 * What one page of {@link EntityWrites.reindexChunk} did. `reindexed + failures.length === walked`.
 * A `null` cursor means the walk is exhausted — there is no further page to ask for.
 */
export interface ReindexChunk {
  readonly walked: number;
  readonly reindexed: number;
  readonly failures: readonly ReindexFailure[];
  readonly cursor: string | null;
}

/** Everything an insert needs. The import path pre-assigns `id` to resolve wikilinks before insert. */
export interface InsertEntityInput {
  id?: string;
  ownerId: string;
  worldId: string;
  name: string;
  /** The ordered Entity Type set; `types[0]` is primary. Carried alongside `tags`, not in the document. */
  types: readonly string[];
  tags: readonly string[];
  document: EntityDocument;
  /**
   * The Entity's initial Visibility; defaults to `private`. The reconcile sets it from the run's
   * chosen visibility so an imported set can land `shared` in one pass (ADR-0060); a plain create
   * omits it and starts private like any hand-authored Entity.
   */
  visibility?: Visibility;
}

/**
 * The fields an import reconcile overwrites onto an existing Entity, reusing its id (ADR-0060). Owner,
 * grants, and `createdAt` are left untouched — an imported set is a managed reference library whose
 * identity survives reimport, not its authored edits.
 */
export interface ImportOverwrite {
  name: string;
  types: readonly string[];
  tags: readonly string[];
  document: EntityDocument;
  visibility: Visibility;
}

/** A stored `entities` row. */
export type EntityRow = typeof entities.$inferSelect;

/**
 * The narrow handle a `manage` change writes ACL rows through. Runs inside the transaction, before
 * the `seq` bump. The ≥1-Owner / no-such-user / owner-wins invariants are enforced by the caller.
 */
export interface AclWriter {
  /**
   * Grant Editor or Viewer. An existing `owner` row wins, so granting a current Owner
   * viewer/editor never demotes them past the ≥1-Owner invariant.
   */
  upsertGrant(targetUserId: string, role: GrantRole): void;
  /** Revoke an editor/viewer grant. An `owner` row is never silently deleted here. */
  removeGrant(targetUserId: string): void;
  /** Promote to Owner — deliberately overwrites any editor/viewer grant the target held. */
  upsertOwner(targetUserId: string): void;
  /** Drop an Owner row. The ≥1-Owner invariant is the caller's to enforce first. */
  removeOwner(targetUserId: string): void;
}

/**
 * A change to one Entity. The kinds **are** the Rights verbs (ADR-0039, ADR-0045), so the kind
 * determines the predicate and the caller never picks its own gate:
 *
 * | kind             | predicate                 |
 * |------------------|---------------------------|
 * | `edit`           | `canEditSubstanceEntity`  |
 * | `set-visibility` | `canWriteEntity`          |
 * | `delete`         | `canWriteEntity`          |
 * | `manage`         | `ownsEntity` (Owner-only) |
 *
 * A `version` on an `edit` opts into the optimistic-concurrency check and bumps it; a name-only
 * patch omits it. `version` and `updatedAt` move on `edit` alone — bumping either on a sharing or
 * exposure change would 409 an editor's in-flight save, or send a freshly-shared Entity to the top
 * of "Recently edited". `seq` is what moves on all of them.
 */
export type EntityChange =
  | {
      kind: 'edit';
      name?: string;
      tags?: readonly string[];
      /** Present → the type set fully replaces the stored one; omitted → left untouched (ADR-0048). */
      types?: readonly string[];
      document?: EntityDocument;
      /** Present → the base version rides the atomic WHERE and is bumped. */
      version?: number;
    }
  | { kind: 'set-visibility'; visibility: Visibility }
  | { kind: 'manage'; acl?: (w: AclWriter) => void }
  | { kind: 'delete' };

/**
 * `not-found` covers both "no such Entity" and "unreachable" — indistinguishable, so `private`
 * never leaks existence. `conflict` is only reachable from a version-checked `edit`.
 */
export type MutateResult =
  | { status: 'ok'; row: EntityRow }
  | { status: 'conflict'; row: EntityRow }
  | { status: 'not-found' }
  | { status: 'forbidden' };

/**
 * The single write handle for `entities` and `entity_grants` (ADR-0045): it owns the `seq` bump,
 * the derived indexes, and the post-commit emit. An ESLint rule bans `update(entities)` and
 * `insert|delete(entityGrants)` everywhere else.
 *
 * The transaction and the nudge buffer live in {@link WriteOutbox}, shared with `WorldWrites`, so a
 * World membership change can bump the World and its shared Entities under one commit.
 */
@Injectable()
export class EntityWrites {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly outbox: WriteOutbox,
    // Resolves a `types[]` set to its Field schema **scoped to the Entity's World**, so a World's
    // user-defined types resolve too.
    private readonly worldTypeFields: WorldTypeFields,
    // The instance-wide Structured Data Types (ADR-0050), from which a structured value
    // harvests its own edges in the same derive pass.
    private readonly typeFields: TypeFieldRegistry,
    // Post-commit deletion hooks (ADR-0065): the byte-owning Asset subsystem registers a reaper so
    // deleting an Asset Entity takes its bytes/thumbnail with it. Optional — a unit that constructs
    // EntityWrites without the assets wiring simply runs no reapers.
    @Optional() private readonly deletions?: EntityDeletionRegistry,
  ) {}

  /**
   * Run `fn` in the outermost transaction, flushing the nudge outbox on commit. Delegates to
   * {@link WriteOutbox.transact}; see there for why an async callback is a type error.
   */
  transact<T>(fn: () => SyncOnly<T>): T {
    return this.outbox.transact(fn);
  }

  /**
   * Insert a fully-built Entity. The row and its initial Owner land together, so a new Entity is
   * never ownerless. No nudge: nothing can be following an id that did not exist a moment ago.
   */
  insert(input: InsertEntityInput): EntityRow {
    const now = Date.now();
    const derived = this.derive(input.document, input.types, input.worldId);
    const row: EntityRow = {
      id: input.id ?? randomUUID(),
      worldId: input.worldId,
      name: input.name,
      types: [...input.types],
      tags: [...input.tags],
      visibility: input.visibility ?? 'private',
      version: INITIAL_VERSION,
      seq: INITIAL_SEQ,
      document: JSON.stringify(input.document),
      contentText: derived.searchText,
      // The **Thumbnail** designation materialised at the choke point (ADR-0066), a derived column like
      // `contentText` — so a list resolves it through one indexed join, never a read-time `json_extract`.
      thumbnailEntityId: derived.thumbnailEntityId,
      createdAt: now,
      updatedAt: now,
    };
    return this.transact(() => {
      this.db.insert(entities).values(row).run();
      this.db.insert(entityGrants).values({ entityId: row.id, userId: input.ownerId, role: 'owner' }).run();
      this.replaceDerived(row.id, row.worldId, derived);
      return row;
    });
  }

  /**
   * Overwrite an imported Entity in place, reusing its id (ADR-0060) — a **system write** the import
   * reconcile drives once the World's Owner gate has run. Identity-preserving: the id, owner grants,
   * and `createdAt` are kept, so a pre-existing inbound Entity Link still resolves; the document,
   * types, tags, and visibility are replaced wholesale and the derived indexes (`hexly.source`
   * included) re-materialised, so a user's authored edits are *not* preserved across a reimport.
   * Bumps `seq` and nudges. A row that vanished between plan and apply is a silent no-op — the next
   * (idempotent) run reconciles it.
   *
   * Meant to run inside a caller-opened chunk transaction ({@link transact} is re-entrant), so a
   * whole reconcile chunk commits and nudges once.
   */
  importOverwrite(id: string, input: ImportOverwrite): void {
    const now = Date.now();
    this.transact(() => {
      const existing = this.db
        .select({ worldId: entities.worldId, seq: entities.seq, version: entities.version })
        .from(entities)
        .where(eq(entities.id, id))
        .get();
      if (!existing) return;
      const derived = this.derive(input.document, input.types, existing.worldId);
      this.db
        .update(entities)
        .set({
          name: input.name,
          types: [...input.types],
          tags: [...input.tags],
          visibility: input.visibility,
          document: JSON.stringify(input.document),
          contentText: derived.searchText,
          thumbnailEntityId: derived.thumbnailEntityId,
          version: existing.version + 1,
          updatedAt: now,
          seq: existing.seq + 1,
        })
        .where(eq(entities.id, id))
        .run();
      this.replaceDerived(id, existing.worldId, derived);
      this.enqueue(id);
    });
  }

  /**
   * Delete Entities by id, nudging each — a **system write** the import reconcile drives (a Record
   * whose `sourceId` vanished upstream, or a whole importer-owned set on Remove). The World's Owner
   * gate has already run, and the ids are resolved from the provenance index, so no per-Entity Right
   * could refuse it. Batched under the bound-parameter ceiling; grants, links, and derived rows
   * cascade with each Entity.
   */
  importDelete(ids: readonly string[]): void {
    if (ids.length === 0) return;
    this.transact(() => {
      for (const batch of batched(ids, 1)) {
        this.db
          .delete(entities)
          .where(inArray(entities.id, [...batch]))
          .run();
      }
      for (const id of ids) this.enqueue(id);
    });
  }

  /**
   * Delete every Entity in a World, nudging each — a **system write**, so it takes no `userId`: the
   * World's own Owner gate has already run, and no per-Entity Right could refuse it.
   */
  cascadeDeleteWorld(worldId: string): void {
    this.transact(() => {
      const doomed = this.db.select({ id: entities.id }).from(entities).where(eq(entities.worldId, worldId)).all();
      // entity_grants, entity_links, entity_descriptors and entity_edges cascade with each row.
      this.db.delete(entities).where(eq(entities.worldId, worldId)).run();
      for (const { id } of doomed) this.enqueue(id);
    });
  }

  /**
   * A World's membership moved, so the Rights every `shared` Entity in it confers moved too — a
   * **system write**, taking no `userId`: the World's own Owner gate has already run, and no
   * per-Entity Right could refuse it.
   *
   * Entity access reads `owner ∨ grant ∨ (shared ∧ world-member)` and Entity write reads
   * `owner ∨ (shared ∧ world-owner)`, so *every* `world_members` mutation — promotion, demotion,
   * add, remove — changes some principal's standing on the World's shared Entities. Each one's
   * `seq` must be bumped as well as nudged, or the follower's freshness gate drops the nudge and
   * its `rights` array stays stale.
   *
   * `private` Entities are untouched: World membership confers nothing on them.
   *
   * ponytail: fans out over *all* the World's shared Entities, not just the followed ones — the bus
   * keeps no per-World interest index, and `emitEntityChange` short-circuits on no followers. Fine
   * on a small instance; add an index if a huge shared World ever makes this loop hurt.
   */
  bumpWorldShared(worldId: string): void {
    this.transact(() => {
      const shared = this.db
        .select({ id: entities.id })
        .from(entities)
        .where(and(eq(entities.worldId, worldId), sharedVisibility))
        .all();
      if (shared.length === 0) return;
      const ids = shared.map((e) => e.id);
      this.db
        .update(entities)
        .set({ seq: sql`${entities.seq} + 1` })
        .where(inArray(entities.id, ids))
        .run();
      for (const id of ids) this.enqueue(id);
    });
  }

  /**
   * Drop every grant a departing user holds — a **system write**, called when their account is
   * deleted. Bumps `seq` on each touched Entity, so a later nudge reads as newer than a follower's
   * held value, but **emits nothing**: the user's own sessions are dropped with the account, and no
   * other principal's Rights on those Entities changed.
   */
  purgeGrantsOf(userId: string): void {
    this.transact(() => {
      const touched = this.db
        .select({ id: entityGrants.entityId })
        .from(entityGrants)
        .where(eq(entityGrants.userId, userId))
        .all()
        .map((r) => r.id);
      if (touched.length === 0) return;
      this.db.delete(entityGrants).where(eq(entityGrants.userId, userId)).run();
      this.db
        .update(entities)
        .set({ seq: sql`${entities.seq} + 1` })
        .where(inArray(entities.id, touched))
        .run();
    });
  }

  /**
   * Recompute one page of Entities' document-derived state — the unit of the Superadmin Reindex
   * (ADR-0046), driven to exhaustion by the reindex `AdminService`. A **system write** (no
   * `userId`). Idempotent: the writes are wholesale replaces.
   *
   * A chunk, not the instance: `better-sqlite3` is synchronous, so a walk of every Entity in one
   * transaction would pin the event loop. Each page commits as it goes, so a crash leaves the
   * instance partly reindexed — harmless, since the next run resumes. {@link derive} runs outside
   * the transaction (pure, the only step a bad document can throw in): its failures are collected
   * per Entity and skipped while the successes still write; a write error rolls the chunk back.
   * Ordered by `id`, resumed from `after`, stable under concurrent inserts.
   *
   * Lands with no nudge and no `seq` bump: every column it touches is derived — ADR-0046's accepted
   * freshness ceiling.
   */
  reindexChunk(after: string | null, limit: number): ReindexChunk {
    const rows = this.db
      .select({
        id: entities.id,
        worldId: entities.worldId,
        // Facets and link edges derive from the effective set — `types` plus the attachments derived from
        // the `document` (ADR-0048, ADR-0054, ADR-0057, #188).
        types: entities.types,
        document: entities.document,
      })
      .from(entities)
      .where(after === null ? undefined : gt(entities.id, after))
      .orderBy(asc(entities.id))
      .limit(limit)
      .all();
    if (rows.length === 0) return { walked: 0, reindexed: 0, failures: [], cursor: null };

    // Derive first, outside the transaction: pure, and the only step a bad document can throw in.
    const failures: ReindexFailure[] = [];
    const derived: { row: (typeof rows)[number]; derived: DocumentDerivedState }[] = [];
    for (const row of rows) {
      try {
        derived.push({
          row,
          derived: this.derive(JSON.parse(row.document) as EntityDocument, row.types, row.worldId),
        });
      } catch (err) {
        failures.push({
          entityId: row.id,
          worldId: row.worldId,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // A page whose every document was unreadable has nothing to write, and opens no transaction.
    if (derived.length > 0)
      this.transact(() => {
        for (const { row, derived: d } of derived) {
          this.db
            .update(entities)
            .set({ contentText: d.searchText, thumbnailEntityId: d.thumbnailEntityId })
            .where(eq(entities.id, row.id))
            .run();
          this.replaceDerived(row.id, row.worldId, d);
        }
      });

    return {
      walked: rows.length,
      reindexed: derived.length,
      failures,
      // A short page is the last page; a full one may not be, so the next call settles it.
      cursor: rows.length < limit ? null : rows[rows.length - 1].id,
    };
  }

  /**
   * The one derivation of the Entity's document-derived state (CONTEXT.md → Reindex). It takes the whole
   * document, not just the Content: a Hex Map's Entity Links live on its Hexes, Features, and Regions as
   * well as in its prose (ADR-0046), and so do the names it is searchable by (#205).
   *
   * This method's job is host-side: resolve the effective Field set and the registered data-types, then
   * hand them to {@link deriveDocumentState}, which owns the pure walk. It names no extractor of its own —
   * a **Field of a Structured Data Type** offers its own edges, text, and facets through the data-type set,
   * so a new plugin needs no change here.
   */
  private derive(doc: EntityDocument, types: readonly string[], worldId: string): DocumentDerivedState {
    // The effective Field set (ADR-0054/ADR-0057), scoped to the Entity's World and derived from the
    // document itself: an attached link Field harvests its edge and an attached facetable Field its facet,
    // like a type default.
    const fields = this.worldTypeFields.effectiveFields(worldId, types, doc);
    // Name the **Thumbnail** Field so the pure walk materialises its designation (ADR-0066) without the
    // domain learning any plugin's Field id. A disabled asset plugin leaves the key unresolved in the
    // effective set, so the designation derives to `null` and the value sits inert — no guard needed here.
    return deriveDocumentState(doc, fields, this.typeFields.structuredDataTypes, {
      thumbnailFieldId: CORE_THUMBNAIL_FIELD_ID,
    });
  }

  /**
   * Replace the Entity's derived index rows with the freshly harvested sets — wholesale, no
   * diffing, so they are self-pruning. Must run in the same transaction as the document write, so the
   * indexes reflect the last *successful* save and never a rejected one.
   */
  private replaceDerived(id: string, worldId: string, derived: DocumentDerivedState): void {
    this.replaceDescriptors(id, derived.descriptors);
    this.replaceEdges(id, worldId, derived.edges);
    this.replaceFieldFacets(id, worldId, derived.fieldFacets);
    this.replaceImportSource(id, worldId, derived.importSource);
    this.replaceAssetIndex(id, worldId, derived.assetHash);
  }

  /**
   * Replace the Entity's **Asset dedup index** row with the freshly derived content hash (self-pruning,
   * ADR-0065): an asset-ref-carrying document materialises one row keyed on the bytes' hash, clearing the
   * ref removes it, and the FK cascade drops it with the Entity. Derived, never authoritative — an index
   * over the document like the edge and provenance sets, so `worldId` is denormalised off the source.
   */
  private replaceAssetIndex(id: string, worldId: string, hash: string | null): void {
    this.db.delete(assetIndex).where(eq(assetIndex.entityId, id)).run();
    if (hash) this.db.insert(assetIndex).values({ entityId: id, worldId, hash }).run();
  }

  /**
   * Replace the Entity's **Import Source** row with the freshly derived provenance (self-pruning,
   * ADR-0060): a `hexly.source`-carrying document materialises one row, clearing or changing the stamp
   * rewrites it, and the FK cascade drops it with the Entity. Derived, never authoritative — an index
   * over the document like the edge and facet sets, so `worldId` is denormalised off the source.
   */
  private replaceImportSource(id: string, worldId: string, source: ImportSource | null): void {
    this.db.delete(entityImportSource).where(eq(entityImportSource.entityId, id)).run();
    if (source)
      this.db
        .insert(entityImportSource)
        .values({ entityId: id, worldId, importer: source.importer, sourceId: source.sourceId, rev: source.rev })
        .run();
  }

  /**
   * Replace the Entity's Field-facet rows with the freshly derived set (self-pruning, ADR-0048).
   * `worldId` is denormalised off the source, so a World-scoped facet read is one indexed lookup.
   */
  private replaceFieldFacets(id: string, worldId: string, facets: readonly FieldFacetValue[]): void {
    this.db.delete(entityFieldFacets).where(eq(entityFieldFacets.entityId, id)).run();
    for (const batch of batched(facets, FIELD_FACET_COLUMNS)) {
      this.db
        .insert(entityFieldFacets)
        .values(
          batch.map((f) => ({
            entityId: id,
            worldId,
            key: f.key,
            value: f.value,
            num: f.num,
          })),
        )
        .run();
    }
  }

  /** Replace the Entity's descriptor rows with the harvested set (self-pruning). */
  private replaceDescriptors(id: string, descriptors: readonly string[]): void {
    this.db.delete(entityDescriptors).where(eq(entityDescriptors.entityId, id)).run();
    for (const batch of batched(descriptors, DESCRIPTOR_COLUMNS)) {
      this.db
        .insert(entityDescriptors)
        .values(batch.map((descriptor) => ({ entityId: id, descriptor })))
        .run();
    }
  }

  /**
   * Replace the Entity's outbound edge rows with the harvested set (self-pruning). `worldId` is
   * denormalized off the source here — the one place it can be, since an edge has no other
   * relation to a World.
   */
  private replaceEdges(id: string, worldId: string, edges: readonly EntityEdge[]): void {
    this.db.delete(entityEdges).where(eq(entityEdges.sourceEntityId, id)).run();
    for (const batch of batched(edges, EDGE_COLUMNS)) {
      this.db
        .insert(entityEdges)
        .values(batch.map((edge) => ({ ...edge, sourceEntityId: id, worldId })))
        .run();
    }
  }

  /**
   * Apply `change` to Entity `id` on `userId`'s behalf: gate on the kind's predicate, write, bump
   * `seq`, and nudge followers once the write has committed.
   */
  mutate(userId: string, id: string, change: EntityChange): MutateResult {
    const access = entityAccess(this.db, userId);
    const decision = access.decide(id);
    // Unreachable is indistinguishable from nonexistent — ownership never leaks.
    if (!decision?.canRead) return { status: 'not-found' };
    const permitted =
      change.kind === 'edit'
        ? decision.canEditSubstance
        : change.kind === 'manage'
          ? decision.isOwner
          : decision.canWrite;
    if (!permitted) return { status: 'forbidden' };

    const result = this.transact(() => {
      const applied = this.apply(access, decision.row, change);
      // The choke point: every committed change nudges, whatever its kind.
      if (applied.status === 'ok') this.enqueue(id);
      return applied;
    });

    // Post-commit deletion side effects (ADR-0065): once the row is gone for good, reap any bytes it
    // owned. Outside the transaction so a rolled-back delete never takes the bytes with it; the deleted
    // row's last document carries the asset-ref a reaper reads.
    if (change.kind === 'delete' && result.status === 'ok') this.reapDeletion(result.row);

    return result;
  }

  /** Fire the registered deletion reapers for a just-committed single-Entity delete (ADR-0065). */
  private reapDeletion(row: EntityRow): void {
    if (!this.deletions) return;
    this.deletions.reap({
      id: row.id,
      worldId: row.worldId,
      types: row.types,
      document: JSON.parse(row.document) as EntityDocument,
    });
  }

  /**
   * The per-kind write. The gate predicate rides the atomic WHERE (not just the read above), so a
   * concurrent visibility flip between {@link entityAccess.decide} and the UPDATE means zero rows
   * matched and the write never lands — never a fake 200.
   */
  private apply(access: EntityAccess, row: EntityRow, change: EntityChange): MutateResult {
    const id = row.id;
    const seq = row.seq + 1;

    if (change.kind === 'delete') {
      // entity_grants, entity_links, entity_descriptors and entity_edges cascade with the row.
      // Its *inbound* edges do not: they are keyed by their own source, which still holds the link.
      const res = this.db
        .delete(entities)
        .where(and(eq(entities.id, id), access.writeFilter))
        .run();
      return res.changes === 0 ? { status: 'not-found' } : { status: 'ok', row };
    }

    if (change.kind === 'manage') {
      change.acl?.(this.aclWriter(id));
      // Sharing changed but no `entities` column did: `seq` alone carries the freshness.
      this.db.update(entities).set({ seq }).where(eq(entities.id, id)).run();
      return { status: 'ok', row: { ...row, seq } };
    }

    if (change.kind === 'set-visibility') {
      // Exposure, not substance: no `version` bump (it would 409 an in-flight save) and no
      // `updatedAt` bump (it would lie in "edited {date}" and reorder the Entity Browser).
      const set = { visibility: change.visibility, seq };
      const res = this.db
        .update(entities)
        .set(set)
        // Evaluated pre-SET, so a shared→private re-hide still matches.
        .where(and(eq(entities.id, id), access.writeFilter))
        .run();
      return res.changes === 0 ? { status: 'not-found' } : { status: 'ok', row: { ...row, ...set } };
    }

    // `edit`: substance. Set only the columns the caller owns, so a concurrent rename isn't
    // clobbered by a save that never touched the name. The derivation runs over the effective set — the
    // save's type set when it carries it, else the stored one, with attachments derived from the document
    // itself (ADR-0048, ADR-0054, ADR-0057).
    //
    // `hexly.*` is system-owned provenance (ADR-0060): a user edit may neither forge nor drop it. Strip
    // the incoming copy and restore the stored one — so a forged `hexly.source` never materialises a
    // provenance row (nor 500s on the unique index), and editing an imported Entity keeps its stamp
    // rather than orphaning it.
    const document =
      change.document !== undefined
        ? { ...stripReservedKeys(change.document), ...reservedKeys(JSON.parse(row.document) as EntityDocument) }
        : undefined;
    const derived = document && this.derive(document, change.types ?? row.types, row.worldId);
    const set = {
      ...(change.name !== undefined && { name: change.name }),
      ...(change.tags !== undefined && { tags: [...change.tags] }),
      ...(change.types !== undefined && { types: [...change.types] }),
      ...(change.document !== undefined && {
        document: JSON.stringify(document),
        contentText: derived?.searchText,
        // Re-materialise the **Thumbnail** designation on every substance edit (ADR-0066): setting,
        // changing, or clearing the `core.field.thumbnail` value moves the derived column with the document.
        thumbnailEntityId: derived?.thumbnailEntityId ?? null,
      }),
      ...(change.version !== undefined && { version: change.version + 1 }),
      updatedAt: Date.now(),
      seq,
    };
    const res = this.db
      .update(entities)
      .set(set)
      .where(
        and(
          eq(entities.id, id),
          access.editFilter,
          // The optimistic-concurrency token: a concurrent edit is a conflict, not an overwrite.
          change.version !== undefined ? eq(entities.version, change.version) : undefined,
        ),
      )
      .run();
    if (res.changes > 0) {
      // Same transaction as the document write, so the indexes always reflect the last *successful*
      // save, never a rejected one.
      if (derived) this.replaceDerived(id, row.worldId, derived);
      return { status: 'ok', row: { ...row, ...set } };
    }
    // Zero rows: the version moved, or the predicate stopped matching. Re-read to tell them apart.
    const current = access.decide(id);
    if (!current?.canRead) return { status: 'not-found' };
    return change.version !== undefined ? { status: 'conflict', row: current.row } : { status: 'not-found' };
  }

  /** The `entity_grants` write handle handed to a `manage` change. */
  private aclWriter(id: string): AclWriter {
    const target = (targetUserId: string) => and(eq(entityGrants.entityId, id), eq(entityGrants.userId, targetUserId));
    return {
      upsertGrant: (targetUserId, role) => {
        this.db
          .insert(entityGrants)
          .values({ entityId: id, userId: targetUserId, role })
          .onConflictDoUpdate({
            target: [entityGrants.entityId, entityGrants.userId],
            set: { role },
            // Owner wins: Owners move only through upsertOwner/removeOwner.
            setWhere: ne(entityGrants.role, 'owner'),
          })
          .run();
      },
      removeGrant: (targetUserId) => {
        this.db
          .delete(entityGrants)
          // An `owner` row leaves only through the ≥1-Owner-guarded owner-set path.
          .where(and(target(targetUserId), inArray(entityGrants.role, ['editor', 'viewer'])))
          .run();
      },
      upsertOwner: (targetUserId) => {
        this.db
          .insert(entityGrants)
          .values({ entityId: id, userId: targetUserId, role: 'owner' })
          .onConflictDoUpdate({
            target: [entityGrants.entityId, entityGrants.userId],
            set: { role: 'owner' },
          })
          .run();
      },
      removeOwner: (targetUserId) => {
        this.db
          .delete(entityGrants)
          .where(and(target(targetUserId), eq(entityGrants.role, 'owner')))
          .run();
      },
    };
  }

  /** The only door into the outbox: queue an Entity nudge for the open transaction's commit. */
  private enqueue(id: string): void {
    this.outbox.entity(id);
  }
}
