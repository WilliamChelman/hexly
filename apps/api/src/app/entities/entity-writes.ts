import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  EntityBody,
  EntityEdge,
  FieldFacetValue,
  GrantRole,
  ReindexFailure,
  Visibility,
  descriptorsSchema,
  deriveFieldFacets,
  extractText,
  harvestEdges,
  resolveFields,
} from '@hexly/domain';
import { and, asc, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import { EntityAccess, entityAccess, sharedVisibility } from '../acl/entity-access';
import { DB, Db } from '../db/db';
import { INITIAL_SEQ, entities, entityDescriptors, entityEdges, entityFieldFacets, entityGrants } from '../db/schema';
import { SyncOnly, WriteOutbox } from '../events/write-outbox';
import { TypeFieldRegistry } from './type-field-registry';
import { WorldTypeFields } from './world-type-fields';

/** A fresh Entity starts at version 1 — the optimistic-concurrency token's floor. */
const INITIAL_VERSION = 1;

/** Everything one save derives from the Entity's document (and its types), in one pass. */
interface Derived {
  contentText: string;
  descriptors: string[];
  edges: EntityEdge[];
  /** The denormalised facetable Field values (ADR-0048, #188) — depends on `types` *and* Metadata. */
  fieldFacets: FieldFacetValue[];
}

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
  /** The ordered Entity Type set; `types[0]` is primary. Carried alongside `tags`, not in the body. */
  types: readonly string[];
  tags: readonly string[];
  body: EntityBody;
}

/** A stored `entities` row. */
export type EntityRow = typeof entities.$inferSelect;

/**
 * The narrow handle a `manage` change writes ACL rows through. It exists so the *invariants*
 * (≥1-Owner, no-such-user, owner-wins upsert) can stay in the service that reads best with them,
 * while the `entity_grants` write itself stays inside {@link EntityWrites} — which is what makes
 * the "no write without a nudge" guard structural rather than a convention. Runs inside the
 * transaction, before the `seq` bump.
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
      document?: EntityBody;
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
 * The single write handle for `entities` and `entity_grants` (ADR-0045). It owns the `seq` bump,
 * the derived indexes, and the post-commit emit — so a write *cannot* land without nudging its
 * followers. An ESLint rule bans `update(entities)` and `insert|delete(entityGrants)` everywhere
 * else.
 *
 * The transaction and the nudge buffer live in {@link WriteOutbox}, shared with `WorldWrites`, so
 * a World membership change can bump the World and its shared Entities under one commit.
 */
@Injectable()
export class EntityWrites {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly outbox: WriteOutbox,
    // Resolves a `types[]` set to its Field schema **scoped to the Entity's World**, so the derive
    // pass materialises the facetable Field values (ADR-0048, #188) — including a World's
    // user-defined types (#191) — the same way it harvests edges and descriptors.
    private readonly worldTypeFields: WorldTypeFields,
    // The instance-wide Structured Field data-types (ADR-0050), from which a structured value
    // harvests its own edges in the same derive pass.
    private readonly typeFields: TypeFieldRegistry,
  ) {}

  /**
   * Run `fn` in the outermost transaction, flushing the nudge outbox on commit — the seam a caller
   * that spans several write handles (the Admin account purge) reaches for. Delegates to
   * {@link WriteOutbox.transact}; see there for why an async callback is a type error.
   */
  transact<T>(fn: () => SyncOnly<T>): T {
    return this.outbox.transact(fn);
  }

  /**
   * Insert a fully-built Entity — the single trunk behind `create` and the vault import. The row
   * and its initial Owner land together, so a new Entity is never ownerless. No nudge: nothing can
   * be following an id that did not exist a moment ago.
   */
  insert(input: InsertEntityInput): EntityRow {
    const now = Date.now();
    const derived = this.derive(input.body, input.types, input.worldId);
    const row: EntityRow = {
      id: input.id ?? randomUUID(),
      worldId: input.worldId,
      name: input.name,
      types: [...input.types],
      tags: [...input.tags],
      visibility: 'private',
      version: INITIAL_VERSION,
      seq: INITIAL_SEQ,
      document: JSON.stringify(input.body),
      contentText: derived.contentText,
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
   * Delete every Entity in a World, nudging each — a **system write**, so it takes no `userId`:
   * the World's own Owner gate has already run, and no per-Entity Right could refuse it. Each
   * cascaded Entity's followers evict to `unavailable` on their own ref, which ADR-0044 deferred
   * and left them stranded on a ghost row.
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
   * add, remove — changes some principal's standing on the World's shared Entities. It therefore
   * bumps each one's `seq` and nudges: a promoted World Owner's open Entity gains its Save button,
   * and a removed member's follow evicts. Emitting without the bump would be a half-fix — the
   * follower's freshness gate would drop the nudge and its `rights` array would stay stale
   * (ADR-0045 rejects exactly that).
   *
   * `private` Entities are untouched: World membership confers nothing on them, so nobody's Rights
   * moved and there is nothing to refetch.
   *
   * ponytail: fans out over *all* the World's shared Entities, not just the followed ones — the
   * bus keeps no per-World interest index, and `emitEntityChange` short-circuits on no followers.
   * Fine on a small instance; add an index if a huge shared World ever makes this loop hurt.
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
   * deleted. It bumps `seq` on each touched Entity, because the Entity's sharing state moved and a
   * later nudge must read as newer than a follower's held value, but deliberately **emits
   * nothing**: the user's own sessions are dropped with the account, so they self-evict, and no
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
   * (ADR-0046), driven to exhaustion by the reindex `AdminService`. A **system write** (no `userId`): the
   * Superadmin sits outside the collaboration model. Re-runs {@link derive} and
   * {@link replaceDerived}, so any derivation added there is backfilled retroactively for free;
   * idempotent, since the writes are wholesale replaces.
   *
   * A chunk, not the instance: `better-sqlite3` is synchronous, so a walk of every Entity in one
   * transaction would pin the event loop. The page is the seam the caller yields on and bounds the
   * transaction — it commits as it goes, so a crash leaves the instance partly reindexed, harmless
   * since the next run resumes. {@link derive} runs outside the transaction (pure, the only step a
   * bad document can throw in): its failures are collected per Entity and skipped while the
   * successes still write; a write error rolls the chunk back. Ordered by `id`, resumed from
   * `after`, stable under concurrent inserts.
   *
   * Lands with no nudge and no `seq` bump: every column it touches is derived, and a recompute from
   * an unchanged document writes back what it read — ADR-0046's accepted freshness ceiling.
   */
  reindexChunk(after: string | null, limit: number): ReindexChunk {
    const rows = this.db
      .select({
        id: entities.id,
        worldId: entities.worldId,
        // Field facets derive from the type set as well as the document (ADR-0048, #188), so the
        // reindex projection carries `types` — the one derivation that reads a column beyond `document`.
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
    const derived: { row: (typeof rows)[number]; derived: Derived }[] = [];
    for (const row of rows) {
      try {
        derived.push({
          row,
          derived: this.derive(JSON.parse(row.document) as EntityBody, row.types, row.worldId),
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
          this.db.update(entities).set({ contentText: d.contentText }).where(eq(entities.id, row.id)).run();
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
   * The one derivation of the Entity's document, in one place — {@link EntityWrites} is the only
   * caller of `extractText` and `harvestEdges`. Splitting them is what let an imported vault
   * populate the search index while contributing nothing to the `::` Link Descriptor vocabulary.
   *
   * It takes the whole body, not just the Content: a Hex Map's Entity Links live on its Hexes,
   * Features, and Regions as well as in its prose (ADR-0046).
   *
   * The `::` vocabulary is a *projection* of the edge set, not a second walk: only a
   * `content → entity` edge carries a descriptor, so the non-null ones are exactly the descriptors
   * the Content uses. One traversal, and one definition of what a descriptor is.
   */
  private derive(body: EntityBody, types: readonly string[], worldId: string): Derived {
    // Resolved once, shared by the two derivations that read the type set: the edge harvest's
    // Entity-Link Fields (#190) and the facet derivation's facetable Fields (#188). Scoped to the
    // Entity's World so a user-defined type's Fields resolve too (#191).
    const fields = resolveFields(this.worldTypeFields.resolverFor(worldId), types);
    const edges = harvestEdges(body, fields, this.typeFields.structuredDataTypes);
    return {
      contentText: extractText(body.content),
      descriptors: descriptorsSchema.parse(edges.flatMap((e) => e.descriptor ?? [])),
      edges,
      fieldFacets: deriveFieldFacets(fields, body.metadata),
    };
  }

  /**
   * Replace the Entity's derived index rows with the freshly harvested sets — wholesale, no
   * diffing, so both are self-pruning. Always runs in the same transaction as the body write, so
   * the indexes reflect the last *successful* save and never a rejected one.
   */
  private replaceDerived(id: string, worldId: string, derived: Derived): void {
    this.replaceDescriptors(id, derived.descriptors);
    this.replaceEdges(id, worldId, derived.edges);
    this.replaceFieldFacets(id, worldId, derived.fieldFacets);
  }

  /**
   * Replace the Entity's Field-facet rows with the freshly derived set (self-pruning, ADR-0048,
   * #188). `worldId` is denormalised off the source, mirroring {@link replaceEdges}, so a
   * World-scoped facet read is one indexed lookup.
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

    return this.transact(() => {
      const result = this.apply(access, decision.row, change);
      // The choke point: every committed change nudges, whatever its kind.
      if (result.status === 'ok') this.enqueue(id);
      return result;
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
    // clobbered by a save that never touched the name. Field facets ride the document derivation,
    // resolved against the save's type set when it carries one, else the stored types (ADR-0048).
    const derived = change.document && this.derive(change.document, change.types ?? row.types, row.worldId);
    const set = {
      ...(change.name !== undefined && { name: change.name }),
      ...(change.tags !== undefined && { tags: [...change.tags] }),
      ...(change.types !== undefined && { types: [...change.types] }),
      ...(change.document !== undefined && {
        document: JSON.stringify(change.document),
        contentText: derived?.contentText,
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
      // Same transaction as the body write, so the indexes always reflect the last *successful*
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
