import { ConflictException, Inject, Injectable } from '@nestjs/common';
import {
  HEXLY_SOURCE_KEY,
  Importer,
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
import { entityImportSource } from '../db/schema';
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

/** How the owner-gated import surface refuses: unreachable World ≡ missing, reachable-but-not-Owner ≡ 403. */
export type ImportGate = 'not-found' | 'forbidden' | 'no-such-importer';

/** One reconcile operation, resolved up front off the diff and then applied in chunks. */
type ReconcileOp =
  | { kind: 'create'; input: InsertEntityInput }
  | { kind: 'update'; id: string; input: ImportOverwrite }
  | { kind: 'delete'; id: string };

/**
 * The generic, importer-agnostic import reconcile (ADR-0060) — the framework half every Importer
 * inherits. Owns each World's one import run: it fetches an {@link Importer}'s production up front (off
 * the DB, continue-on-error with skips tallied), diffs it against the `entityImportSource` provenance
 * index for `(world, importer)`, then applies create/update/delete in `seq`-bumping chunks that each
 * commit and yield (the Reindex batching pattern, ADR-0046). Upsert reuses the existing Entity id so
 * inbound links and grants survive; a `sourceId` that vanished upstream is deleted; every landed Entity
 * is stamped `hexly.source`. A second run for a World while one is in flight is refused (409).
 *
 * Job state lives on this singleton keyed by World, not a table — each chunk commits, so a restart
 * forgets an unfinished run whose done chunks are already on disk.
 */
@Injectable()
export class ImportReconcileService {
  private readonly jobs = new Map<string, ImportRunSummary>();

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly writes: EntityWrites,
    private readonly registry: ImporterRegistry,
  ) {}

  /** The Importers available for a World — whatever the enabled Plugins registered. Owner-gated. */
  list(userId: string, worldId: string): ImporterSummary[] | ImportGate {
    const gate = this.gate(userId, worldId);
    return gate ?? this.registry.list();
  }

  /** Where the World's import run stands — the poll target. Owner-gated; idle before any run. */
  status(userId: string, worldId: string): ImportRunSummary | ImportGate {
    const gate = this.gate(userId, worldId);
    return gate ?? this.jobs.get(worldId) ?? IDLE;
  }

  /**
   * Start (or reimport) an Importer into a World and return at once, leaving the reconcile running
   * behind the response — the client follows it by polling {@link status}. Owner-gated; a 409 when a
   * run is already in flight for this World. `run` never rejects: it lands every fault in the job.
   */
  start(userId: string, worldId: string, importerId: string, visibility: Visibility): ImportRunSummary | ImportGate {
    const gate = this.gate(userId, worldId);
    if (gate) return gate;
    const importer = this.registry.get(importerId);
    if (!importer) return 'no-such-importer';
    if (this.jobs.get(worldId)?.status === 'running')
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
   */
  remove(userId: string, worldId: string, importerId: string): ImportGate | 'ok' {
    const gate = this.gate(userId, worldId);
    if (gate) return gate;
    if (!this.registry.get(importerId)) return 'no-such-importer';
    const ids = this.ownedEntityIds(worldId, importerId);
    // Chunked like the reconcile: a large bestiary deletes without pinning the event loop in one commit.
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) this.writes.importDelete(ids.slice(i, i + CHUNK_SIZE));
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
    const existing = this.existingBySourceId(worldId, importer);
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

  /** The provenance index for `(world, importer)` as `sourceId → entityId` — the reconcile's upsert-match map. */
  private existingBySourceId(worldId: string, importer: string): Map<string, string> {
    return new Map(
      this.db
        .select({ sourceId: entityImportSource.sourceId, entityId: entityImportSource.entityId })
        .from(entityImportSource)
        .where(and(eq(entityImportSource.worldId, worldId), eq(entityImportSource.importer, importer)))
        .all()
        .map((row) => [row.sourceId, row.entityId]),
    );
  }

  /** Every Entity id `(world, importer)` owns, off the provenance index — the Remove/prune target. */
  private ownedEntityIds(worldId: string, importer: string): string[] {
    return this.db
      .select({ entityId: entityImportSource.entityId })
      .from(entityImportSource)
      .where(and(eq(entityImportSource.worldId, worldId), eq(entityImportSource.importer, importer)))
      .all()
      .map((row) => row.entityId);
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
