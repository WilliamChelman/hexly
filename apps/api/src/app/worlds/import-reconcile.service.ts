import { ConflictException, Inject, Injectable } from '@nestjs/common';
import {
  HEXLY_SOURCE_KEY,
  Importer,
  ImportedState,
  ImporterErrorCode,
  ImporterSummary,
  ImportRecord,
  ImportRunSummary,
  ImportSkip,
  nameSchema,
  typesSchema,
  Visibility,
  EntityDocument,
} from '@hexly/domain';
import { and, eq, SQL } from 'drizzle-orm';
import { worldAccess } from '../acl/world-access';
import { DB, Db } from '../db/db';
import { entities, entityImportSource } from '../db/schema';
import { EntityWrites, ImportOverwrite, InsertEntityInput } from '../entities/entity-writes';
import { CompendiumWrites } from './compendium-writes';
import { compendiumByImporter } from './compendiums';
import { ImporterRegistry } from './importer-registry';

/** Records applied per transaction, and the granularity at which the reconcile yields the event loop. */
const CHUNK_SIZE = 200;

/** The state of a World that has seen no import run this process. */
const IDLE: ImportRunSummary = {
  importer: null,
  rev: null,
  status: 'idle',
  total: 0,
  created: 0,
  updated: 0,
  deleted: 0,
  skipped: [],
  startedAt: null,
  finishedAt: null,
  error: null,
};

/** Hand the event loop back between chunks, so a run's synchronous writes are not all this process does. */
const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * How the owner-gated import surface refuses a call: unreachable World ≡ missing (404),
 * reachable-but-not-Owner ≡ 403, or no such Importer (404). A refusal union, not just the owner gate.
 */
export type ImportRefusal = 'not-found' | 'forbidden' | 'no-such-importer';

/** One reconcile operation, resolved up front off the diff and then applied in chunks. */
type ReconcileOp =
  | { kind: 'create'; input: InsertEntityInput }
  | { kind: 'update'; id: string; input: ImportOverwrite }
  | { kind: 'delete'; id: string };

/**
 * Where one reconcile lands, and what it matches against once there (ADR-0079). An ordinary Importer
 * targets the **World** the run was asked for and matches only what it itself put there, since a World
 * hosts every Importer the enabled Plugins registered. A **Compendium Importer** targets the pack's own
 * **Compendium**, where the match key collapses to the Container alone: `compendiums.importer` is
 * unique, so one pack has exactly one producer and "what this Importer owns here" and "what is here"
 * are the same set.
 */
type ReconcileTarget =
  | { kind: 'world'; containerId: string; importer: string }
  | { kind: 'compendium'; containerId: string };

/**
 * The generic, importer-agnostic import reconcile (ADR-0060): diffs an {@link Importer}'s production
 * against the `entityImportSource` index for its {@link ReconcileTarget} and applies create/update/delete
 * in `seq`-bumping chunks that each commit and yield (ADR-0046). One run or remove at a time per World —
 * a second is a 409. Job state lives on this singleton keyed by World, so a restart forgets an
 * unfinished run whose committed chunks are already on disk.
 *
 * The target is the Importer's to declare, not the caller's — which is why no World-scoped read needed a
 * predicate for reference material (ADR-0079).
 */
@Injectable()
export class ImportReconcileService {
  private readonly jobs = new Map<string, ImportRunSummary>();
  /**
   * The {@link scopeOf} keys a run or a remove is currently holding. Both yield between chunks, so
   * anything that would write the same Container has to queue behind rather than interleave with them.
   */
  private readonly reconciling = new Set<string>();

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly writes: EntityWrites,
    private readonly compendiums: CompendiumWrites,
    private readonly registry: ImporterRegistry,
  ) {}

  /**
   * The Importers available for a World — whatever the enabled Plugins registered — each carrying the
   * last-known imported state the provenance index still records, so the panel's last-run line survives
   * an API restart (#260). Owner-gated.
   *
   * A Compendium Importer's state is read off *its* Compendium, not this World: the pack is
   * Instance-wide, so the line reads the same in every World (ADR-0079).
   */
  list(userId: string, worldId: string): ImporterSummary[] | ImportRefusal {
    const gate = this.gate(userId, worldId);
    if (gate) return gate;
    return this.registry.list().map((summary) => {
      const target = this.installedTarget(summary.id, worldId);
      const lastImported = target && this.lastImported(target);
      return lastImported ? { ...summary, lastImported } : summary;
    });
  }

  /** Where the World's import run stands — the poll target. Owner-gated; idle before any run. */
  status(userId: string, worldId: string): ImportRunSummary | ImportRefusal {
    const gate = this.gate(userId, worldId);
    return gate ?? this.jobs.get(worldId) ?? IDLE;
  }

  /**
   * Start (or reimport) an Importer into a World and return at once, leaving the reconcile running
   * behind the response — the client follows it by polling {@link status}. Owner-gated; a 409 when a
   * run is already in flight for this World, or when this Importer's target is already being
   * reconciled from elsewhere. `run` never rejects: it lands every fault in the job.
   */
  start(userId: string, worldId: string, importerId: string, visibility: Visibility): ImportRunSummary | ImportRefusal {
    const gate = this.gate(userId, worldId);
    if (gate) return gate;
    const importer = this.registry.get(importerId);
    if (!importer) return 'no-such-importer';
    // One reconcile at a time per World, and one per target: a run in flight here, or a run or remove
    // mid-yield against the same Container from anywhere, refuses a start (409).
    const scope = this.scopeOf(importer, worldId);
    if (this.jobs.get(worldId)?.status === 'running' || this.reconciling.has(scope))
      throw new ConflictException({ code: ImporterErrorCode.ImportRunning });
    this.jobs.set(worldId, { ...IDLE, importer: importerId, status: 'running', startedAt: Date.now() });
    this.reconciling.add(scope);
    // Deliberately not awaited: the reconcile outlives the request that asked for it.
    void this.run(userId, worldId, importer, visibility, scope);
    return this.jobs.get(worldId) as ImportRunSummary;
  }

  /**
   * Remove an Importer's whole set: delete every Entity the provenance index attributes to its
   * {@link ReconcileTarget}, with no recreate. Owner-gated; a World's hand-authored Entities are
   * untouched because the delete is keyed by the derived `entityImportSource` index alone.
   *
   * Removing a **pack** goes one step further and drops the Compendium Container itself, so the shelf
   * stops being installed rather than lingering empty at a revision nothing reflects. Adopted copies
   * live in a World and are untouched by either half (ADR-0079).
   *
   * Refused with a 409 while a run is in flight for this World, or while anything else is reconciling
   * the same target: the run yields between chunks, so an interleaved delete would evict the Entities it
   * has committed so far and leave a half-imported Container behind a "succeeded" run — and for a pack,
   * would drop the Container out from under an insert still running. Held under {@link reconciling} for
   * the same reason: this loop yields between chunks too, so a concurrent start must see it.
   */
  async remove(userId: string, worldId: string, importerId: string): Promise<ImportRefusal | 'ok'> {
    const gate = this.gate(userId, worldId);
    if (gate) return gate;
    const importer = this.registry.get(importerId);
    if (!importer) return 'no-such-importer';
    const scope = this.scopeOf(importer, worldId);
    if (this.jobs.get(worldId)?.status === 'running' || this.reconciling.has(scope))
      throw new ConflictException({ code: ImporterErrorCode.ImportRunning });
    this.reconciling.add(scope);
    try {
      // A pack never installed has no target and nothing to remove — the same no-op as an Importer
      // that has produced nothing into this World.
      const target = this.installedTarget(importerId, worldId);
      if (!target) return 'ok';
      const ids = this.provenanceRows(target).map((row) => row.entityId);
      // Chunked and yielding between commits (ADR-0046): a large bestiary deletes without pinning the
      // event loop, and the yields are what oblige a run to serialize against it.
      for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
        this.writes.importDelete(ids.slice(i, i + CHUNK_SIZE));
        await yieldToEventLoop();
      }
      // The entries are gone, so the Container's `entities.container_id` references are too: dropping
      // it now takes the satellite — the pinned rev and the attribution — with it.
      if (target.kind === 'compendium') this.compendiums.uninstall(target.containerId);
    } finally {
      this.reconciling.delete(scope);
    }
    return 'ok';
  }

  /**
   * Drive one run to completion behind the response. Only a fault in the Importer's fetch or a chunk's
   * *write* reaches the catch (→ `failed`); an ill-shaped Record is collected as a skip and the run
   * carries on. Yields before the first chunk (an `async` fn runs synchronously to its first `await`),
   * so a small World is not wholly reconciled before the POST returns.
   */
  private async run(
    userId: string,
    worldId: string,
    importer: Importer,
    visibility: Visibility,
    scope: string,
  ): Promise<void> {
    try {
      await yieldToEventLoop();
      const { rev, records } = await importer.produce({});
      // Resolved only once the `rev` is known: installing a pack *is* recording the revision it landed
      // at, so a run that never got past its fetch installs nothing (ADR-0079).
      const target = this.resolveTarget(importer, worldId, rev);
      const { ops, skipped, total } = this.plan(userId, target, importer.id, rev, records, visibility);
      // Record the pinned rev the moment it is known, so a poll mid-run — and the finished status line — carries it.
      this.jobs.set(worldId, { ...(this.jobs.get(worldId) as ImportRunSummary), rev, total, skipped });
      for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
        const chunk = ops.slice(i, i + CHUNK_SIZE);
        this.apply(chunk);
        const job = this.jobs.get(worldId) as ImportRunSummary;
        this.jobs.set(worldId, {
          ...job,
          created: job.created + chunk.filter((op) => op.kind === 'create').length,
          updated: job.updated + chunk.filter((op) => op.kind === 'update').length,
          deleted: job.deleted + chunk.filter((op) => op.kind === 'delete').length,
        });
        await yieldToEventLoop();
      }
      this.jobs.set(worldId, {
        ...(this.jobs.get(worldId) as ImportRunSummary),
        status: 'succeeded',
        finishedAt: Date.now(),
      });
    } catch (err) {
      this.jobs.set(worldId, {
        ...(this.jobs.get(worldId) as ImportRunSummary),
        status: 'failed',
        finishedAt: Date.now(),
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      // Released however the run ended, so a failed run is fixed by re-running it (ADR-0060) rather
      // than by waiting out a hold nothing will ever drop.
      this.reconciling.delete(scope);
    }
  }

  /**
   * Diff the produced Records against the provenance index for the {@link ReconcileTarget}, off the DB
   * and continue-on-error. A well-shaped Record upserts by `sourceId` within the target — reusing the
   * indexed Entity id when one exists, else minting — stamped with the run's `hexly.source`. An indexed
   * `sourceId` no live Record names is deleted. An ill-shaped Record is skipped and tallied; its
   * `sourceId` (when it has one) is still counted as present, so a malformed-but-still-upstream Record
   * does not delete its Entity.
   */
  private plan(
    userId: string,
    target: ReconcileTarget,
    importer: string,
    rev: string,
    records: readonly ImportRecord[],
    visibility: Visibility,
  ): { ops: ReconcileOp[]; skipped: ImportSkip[]; total: number } {
    const existing = new Map(this.provenanceRows(target).map((row) => [row.sourceId, row.entityId]));
    const seen = new Set<string>();
    const ops: ReconcileOp[] = [];
    const skipped: ImportSkip[] = [];

    for (const record of records) {
      const reason = invalidReason(record);
      // A Record with even a `sourceId` marks it present, so a skip never deletes a still-upstream Entity.
      if (typeof record.sourceId === 'string' && record.sourceId.length > 0) seen.add(record.sourceId);
      if (reason) {
        skipped.push({ sourceId: typeof record.sourceId === 'string' ? record.sourceId : '', reason });
        continue;
      }
      const document = this.stamp(record.document, importer, record.sourceId, rev);
      const existingId = existing.get(record.sourceId);
      if (existingId) {
        ops.push({
          kind: 'update',
          id: existingId,
          input: { name: record.name, types: record.types, tags: [], document, visibility },
        });
      } else {
        ops.push({
          kind: 'create',
          input: {
            ownerId: userId,
            containerId: target.containerId,
            name: record.name,
            types: record.types,
            tags: [],
            document,
            visibility,
          },
        });
      }
    }

    for (const [sourceId, id] of existing) if (!seen.has(sourceId)) ops.push({ kind: 'delete', id });
    // `total` is the work the reconcile will do — the landed Records, skips excluded (they never apply).
    return { ops, skipped, total: ops.filter((op) => op.kind !== 'delete').length };
  }

  /** Apply one chunk in a single transaction (re-entrant {@link EntityWrites.transact}), so it commits once. */
  private apply(chunk: readonly ReconcileOp[]): void {
    this.writes.transact(() => {
      for (const op of chunk) {
        if (op.kind === 'create') this.writes.insert(op.input);
        else if (op.kind === 'update') this.writes.importOverwrite(op.id, op.input);
        else this.writes.importDelete([op.id]);
      }
    });
  }

  /** Stamp the reserved `hexly.source` provenance into a Record's document (ADR-0060) — the Importer never does. */
  private stamp(document: EntityDocument, importer: string, sourceId: string, rev: string): EntityDocument {
    return { ...document, [HEXLY_SOURCE_KEY]: { importer, sourceId, rev } };
  }

  /**
   * Where a run of `importer` lands, installing the pack if this is its first (ADR-0079). An ordinary
   * Importer targets the World the run was asked for, exactly as before; a Compendium Importer targets
   * the pack's own Compendium, minted here — and re-captured, `rev` and attribution alike, on every
   * reimport, so the shelf always states the revision its entries actually reflect.
   */
  private resolveTarget(importer: Importer, worldId: string, rev: string): ReconcileTarget {
    if (!importer.compendium) return { kind: 'world', containerId: worldId, importer: importer.id };
    return { kind: 'compendium', containerId: this.compendiums.install(importer.id, importer.compendium, rev) };
  }

  /**
   * What a reconcile of `importer` serializes on. An ordinary Importer writes into the World it was
   * asked for, so the World is the scope, as it always was. A **Compendium Importer** writes into a
   * Container the whole Instance shares, so its own id is the scope — one pack has one producer
   * (ADR-0079), and the id is stable even before the first run has minted a Container to name instead.
   * Without it two Worlds could reconcile one pack at once, or one could uninstall it mid-insert from
   * under another.
   */
  private scopeOf(importer: Importer, worldId: string): string {
    return importer.compendium ? importer.id : worldId;
  }

  /**
   * The {@link ReconcileTarget} an Importer *already* has, without installing one — for the read paths
   * (the panel's last-run line, Remove). A Compendium Importer that has never run has none.
   */
  private installedTarget(importerId: string, worldId: string): ReconcileTarget | undefined {
    if (!this.registry.get(importerId)?.compendium) return { kind: 'world', containerId: worldId, importer: importerId };
    const compendium = compendiumByImporter(this.db, importerId);
    return compendium && { kind: 'compendium', containerId: compendium.id };
  }

  /**
   * The provenance index rows for a {@link ReconcileTarget} as `{ sourceId, entityId }` — the reconcile's
   * upsert-match source (keyed by `sourceId`) and the Remove/prune target (its `entityId`s) alike.
   */
  private provenanceRows(target: ReconcileTarget): { sourceId: string; entityId: string }[] {
    return this.db
      .select({ sourceId: entityImportSource.sourceId, entityId: entityImportSource.entityId })
      .from(entityImportSource)
      .where(targetMatch(target))
      .all();
  }

  /**
   * The last-known imported state for a {@link ReconcileTarget} from the provenance index (#260), or
   * undefined when the Importer owns nothing there. Read off the durable index, not the in-process job,
   * so it outlives a restart. Joins `entities` for the freshest `updatedAt` — when the set was last written.
   */
  private lastImported(target: ReconcileTarget): ImportedState | undefined {
    const rows = this.db
      .select({ rev: entityImportSource.rev, updatedAt: entities.updatedAt })
      .from(entityImportSource)
      .innerJoin(entities, eq(entities.id, entityImportSource.entityId))
      .where(targetMatch(target))
      .all();
    if (rows.length === 0) return undefined;
    // Rows can disagree mid-reimport (chunks apply the new rev one at a time); the most common wins —
    // the revision the bulk of the set is at.
    const tally = new Map<string, number>();
    for (const { rev } of rows) tally.set(rev, (tally.get(rev) ?? 0) + 1);
    const rev = [...tally.entries()].reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
    const updatedAt = rows.reduce((max, row) => Math.max(max, row.updatedAt), 0);
    return { entityCount: rows.length, rev, updatedAt };
  }

  /** Owner gate (ADR-0037): unreachable ≡ missing → 404 (ADR-0004), reachable-but-not-Owner → 403. */
  private gate(userId: string, worldId: string): 'not-found' | 'forbidden' | undefined {
    const meta = worldAccess(this.db, userId).decideMeta(worldId);
    if (!meta || !meta.reachable) return 'not-found';
    if (!meta.isOwner) return 'forbidden';
    return undefined;
  }
}

/**
 * The `entityImportSource` predicate selecting what a {@link ReconcileTarget} already holds — the one
 * place the match key is stated. A World's rows are matched by `(container, importer)`, since every
 * enabled Plugin's Importer shares that Container; a Compendium's by the **container alone**, because
 * one pack has one producer (ADR-0079) and narrowing further would only re-derive what the Container
 * already says.
 */
function targetMatch(target: ReconcileTarget): SQL | undefined {
  const inContainer = eq(entityImportSource.containerId, target.containerId);
  return target.kind === 'compendium' ? inContainer : and(inContainer, eq(entityImportSource.importer, target.importer));
}

/** Why a Record is unlandable, or `undefined` when it is well-shaped — the skip reason the run tallies. */
function invalidReason(record: ImportRecord): string | undefined {
  if (typeof record.sourceId !== 'string' || record.sourceId.length === 0) return 'missing-source-id';
  if (!nameSchema.safeParse(record.name).success) return 'invalid-name';
  if (!typesSchema.safeParse(record.types).success) return 'invalid-types';
  return undefined;
}
