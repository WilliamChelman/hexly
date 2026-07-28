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
import { and, eq } from 'drizzle-orm';
import { worldAccess } from '../acl/world-access';
import { DB, Db } from '../db/db';
import { entities, entityImportSource } from '../db/schema';
import { EntityWrites, ImportOverwrite, InsertEntityInput } from '../entities/entity-writes';
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
 * The generic, importer-agnostic import reconcile (ADR-0060): diffs an {@link Importer}'s production
 * against the `entityImportSource` index for `(world, importer)` and applies create/update/delete in
 * `seq`-bumping chunks that each commit and yield (ADR-0046). One run or remove at a time per World —
 * a second is a 409. Job state lives on this singleton keyed by World, so a restart forgets an
 * unfinished run whose committed chunks are already on disk.
 */
@Injectable()
export class ImportReconcileService {
  private readonly jobs = new Map<string, ImportRunSummary>();
  /** Worlds with an in-flight {@link remove} — it yields between chunks, so a run and a remove must serialize. */
  private readonly removing = new Set<string>();

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly writes: EntityWrites,
    private readonly registry: ImporterRegistry,
  ) {}

  /**
   * The Importers available for a World — whatever the enabled Plugins registered — each carrying the
   * last-known imported state the provenance index still records, so the panel's last-run line survives
   * an API restart (#260). Owner-gated.
   */
  list(userId: string, worldId: string): ImporterSummary[] | ImportRefusal {
    const gate = this.gate(userId, worldId);
    if (gate) return gate;
    return this.registry.list().map((summary) => {
      const lastImported = this.lastImported(worldId, summary.id);
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
   * run is already in flight for this World. `run` never rejects: it lands every fault in the job.
   */
  start(userId: string, worldId: string, importerId: string, visibility: Visibility): ImportRunSummary | ImportRefusal {
    const gate = this.gate(userId, worldId);
    if (gate) return gate;
    const importer = this.registry.get(importerId);
    if (!importer) return 'no-such-importer';
    // One reconcile at a time per World: a run in flight, or a remove mid-yield, refuses a start (409).
    if (this.jobs.get(worldId)?.status === 'running' || this.removing.has(worldId))
      throw new ConflictException({ code: ImporterErrorCode.ImportRunning });
    this.jobs.set(worldId, { ...IDLE, importer: importerId, status: 'running', startedAt: Date.now() });
    // Deliberately not awaited: the reconcile outlives the request that asked for it.
    void this.run(userId, worldId, importer, visibility);
    return this.jobs.get(worldId) as ImportRunSummary;
  }

  /**
   * Remove an Importer's whole set from a World: delete every Entity the provenance index attributes
   * to `(world, importer)`, with no recreate. Owner-gated; hand-authored Entities are untouched
   * because the delete is keyed by the derived `entityImportSource` index alone.
   *
   * Refused with a 409 while a run is in flight for this World (or another remove is): the run yields
   * between chunks, so an interleaved delete would evict the Entities it has committed so far and leave
   * a half-imported World behind a "succeeded" run. Held under {@link removing} for the same reason —
   * this loop yields between chunks too, so a concurrent start must see it.
   */
  async remove(userId: string, worldId: string, importerId: string): Promise<ImportRefusal | 'ok'> {
    const gate = this.gate(userId, worldId);
    if (gate) return gate;
    if (!this.registry.get(importerId)) return 'no-such-importer';
    if (this.jobs.get(worldId)?.status === 'running' || this.removing.has(worldId))
      throw new ConflictException({ code: ImporterErrorCode.ImportRunning });
    this.removing.add(worldId);
    try {
      const ids = this.provenanceRows(worldId, importerId).map((row) => row.entityId);
      // Chunked and yielding between commits (ADR-0046): a large bestiary deletes without pinning the
      // event loop, and the yields are what oblige a run to serialize against it.
      for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
        this.writes.importDelete(ids.slice(i, i + CHUNK_SIZE));
        await yieldToEventLoop();
      }
    } finally {
      this.removing.delete(worldId);
    }
    return 'ok';
  }

  /**
   * Drive one run to completion behind the response. Only a fault in the Importer's fetch or a chunk's
   * *write* reaches the catch (→ `failed`); an ill-shaped Record is collected as a skip and the run
   * carries on. Yields before the first chunk (an `async` fn runs synchronously to its first `await`),
   * so a small World is not wholly reconciled before the POST returns.
   */
  private async run(userId: string, worldId: string, importer: Importer, visibility: Visibility): Promise<void> {
    try {
      await yieldToEventLoop();
      const { rev, records } = await importer.produce({});
      const { ops, skipped, total } = this.plan(userId, worldId, importer.id, rev, records, visibility);
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
    }
  }

  /**
   * Diff the produced Records against the provenance index for `(world, importer)`, off the DB and
   * continue-on-error. A well-shaped Record upserts by `(importer, sourceId)` — reusing the indexed
   * Entity id when one exists, else minting — stamped with the run's `hexly.source`. An indexed
   * `sourceId` no live Record names is deleted. An ill-shaped Record is skipped and tallied; its
   * `sourceId` (when it has one) is still counted as present, so a malformed-but-still-upstream Record
   * does not delete its Entity.
   */
  private plan(
    userId: string,
    worldId: string,
    importer: string,
    rev: string,
    records: readonly ImportRecord[],
    visibility: Visibility,
  ): { ops: ReconcileOp[]; skipped: ImportSkip[]; total: number } {
    const existing = new Map(this.provenanceRows(worldId, importer).map((row) => [row.sourceId, row.entityId]));
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
          input: { ownerId: userId, worldId, name: record.name, types: record.types, tags: [], document, visibility },
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
   * The provenance index rows for `(world, importer)` as `{ sourceId, entityId }` — the reconcile's
   * upsert-match source (keyed by `sourceId`) and the Remove/prune target (its `entityId`s) alike.
   */
  private provenanceRows(worldId: string, importer: string): { sourceId: string; entityId: string }[] {
    return this.db
      .select({ sourceId: entityImportSource.sourceId, entityId: entityImportSource.entityId })
      .from(entityImportSource)
      .where(and(eq(entityImportSource.containerId, worldId), eq(entityImportSource.importer, importer)))
      .all();
  }

  /**
   * The last-known imported state for `(world, importer)` from the provenance index (#260), or undefined
   * when the Importer owns nothing here. Read off the durable index, not the in-process job, so it
   * outlives a restart. Joins `entities` for the freshest `updatedAt` — when the set was last written.
   */
  private lastImported(worldId: string, importer: string): ImportedState | undefined {
    const rows = this.db
      .select({ rev: entityImportSource.rev, updatedAt: entities.updatedAt })
      .from(entityImportSource)
      .innerJoin(entities, eq(entities.id, entityImportSource.entityId))
      .where(and(eq(entityImportSource.containerId, worldId), eq(entityImportSource.importer, importer)))
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

/** Why a Record is unlandable, or `undefined` when it is well-shaped — the skip reason the run tallies. */
function invalidReason(record: ImportRecord): string | undefined {
  if (typeof record.sourceId !== 'string' || record.sourceId.length === 0) return 'missing-source-id';
  if (!nameSchema.safeParse(record.name).success) return 'invalid-name';
  if (!typesSchema.safeParse(record.types).success) return 'invalid-types';
  return undefined;
}
