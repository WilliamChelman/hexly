import { ConflictException, Inject, Injectable } from '@nestjs/common';
import {
  CompendiumDeclaration,
  CompendiumPackSummary,
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

/** The state of a World, or a pack, that has seen no import run this process. */
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
 * How the owner-gated per-World import surface refuses a call: unreachable World ≡ missing (404),
 * reachable-but-not-Owner ≡ 403, or no such Importer (404). A refusal union, not just the owner gate.
 */
export type ImportRefusal = 'not-found' | 'forbidden' | 'no-such-importer';

/** One reconcile operation, resolved up front off the diff and then applied in chunks. */
type ReconcileOp =
  | { kind: 'create'; input: InsertEntityInput }
  | { kind: 'update'; id: string; input: ImportOverwrite }
  | { kind: 'delete'; id: string };

/**
 * What a run was asked for (ADR-0079) — and, since it decides both, the one place the two surfaces
 * differ. A **World** run comes from a World Owner through World Settings and lands in the World it
 * names; a **pack** run comes from the operator through the admin area and lands in the pack's own
 * Compendium, which the declaration carried here is what installs.
 */
type RunSite = { kind: 'world'; worldId: string } | { kind: 'pack'; declaration: CompendiumDeclaration };

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
 * in `seq`-bumping chunks that each commit and yield (ADR-0046). Job state lives on this singleton
 * keyed by {@link scopeOf} — the World for an ordinary Importer, the Importer's own id for a pack,
 * since a pack is Instance-wide — so a restart forgets an unfinished run whose committed chunks are
 * already on disk.
 *
 * It backs two surfaces that never overlap, because an Importer's own declaration decides which one it
 * belongs to: the World Owner's Imports panel lists and runs everything that is *not* a Compendium
 * Importer, and the operator's pack panel lists and runs everything that is (ADR-0079).
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
   * The Importers available for a World — whatever the enabled Plugins registered, minus the packs —
   * each carrying the last-known imported state the provenance index still records, so the panel's
   * last-run line survives an API restart (#260). Owner-gated.
   */
  list(userId: string, worldId: string): ImporterSummary[] | ImportRefusal {
    const gate = this.gate(userId, worldId);
    if (gate) return gate;
    return this.registry
      .all()
      .filter((importer) => !importer.compendium)
      .map((importer) => {
        const summary = toSummary(importer);
        const lastImported = this.lastImported(worldTarget(worldId, importer.id));
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
   * run is already in flight for this World. A pack is a 404 here: it is not this surface's to run.
   */
  start(userId: string, worldId: string, importerId: string): ImportRunSummary | ImportRefusal {
    const gate = this.gate(userId, worldId);
    if (gate) return gate;
    const importer = this.worldImporter(importerId);
    if (!importer) return 'no-such-importer';
    return this.begin(userId, importer, { kind: 'world', worldId });
  }

  /**
   * Remove an Importer's whole set from a World: delete every Entity the provenance index attributes
   * to it there, with no recreate. Owner-gated; a World's hand-authored Entities are untouched because
   * the delete is keyed by the derived `entityImportSource` index alone. A pack is a 404 here.
   *
   * Refused with a 409 while a run is in flight for this World: the run yields between chunks, so an
   * interleaved delete would evict the Entities it has committed so far and leave a half-imported
   * World behind a "succeeded" run.
   */
  async remove(userId: string, worldId: string, importerId: string): Promise<ImportRefusal | 'ok'> {
    const gate = this.gate(userId, worldId);
    if (gate) return gate;
    const importer = this.worldImporter(importerId);
    if (!importer) return 'no-such-importer';
    await this.evict(worldId, () => worldTarget(worldId, importerId));
    return 'ok';
  }

  // ---- the operator's pack surface (ADR-0079) --------------------------------
  //
  // Nothing here takes a World, and nothing here gates: a Container with no members has no per-caller
  // reachability to resolve (ADR-0078), so the Superadmin guard at the controller is the whole gate.

  /**
   * Every compendium pack the enabled Plugins offer: what is installed, at which revision, and where
   * its one run stands. The operator panel's list *and* its poll target — one read answers both, since
   * a pack's run is the only thing about it that moves.
   */
  packs(): CompendiumPackSummary[] {
    return this.registry
      .all()
      .filter((importer) => importer.compendium)
      .map((importer) => {
        const { id, label } = toSummary(importer);
        const row = compendiumByImporter(this.db, id);
        const run = this.jobs.get(id) ?? IDLE;
        if (!row) return { importer: id, label, run };
        const state = this.lastImported({ kind: 'compendium', containerId: row.id });
        return {
          importer: id,
          label,
          installed: {
            id: row.id,
            name: row.name,
            // The revision the shelf *records*, not the one its rows average out to: install pins it
            // (ADR-0061), so a half-applied reimport never reads as a revision bump.
            rev: row.rev,
            entryCount: state?.entityCount ?? 0,
            updatedAt: row.updatedAt,
          },
          run,
        };
      });
  }

  /**
   * Install (or reimport) a pack, returning at once and leaving the reconcile behind the response —
   * the panel follows it by re-reading {@link packs}. A 409 while this pack is already reconciling
   * from anywhere; a 404 for an Importer that is not a pack.
   */
  installPack(userId: string, importerId: string): ImportRunSummary | 'no-such-importer' {
    const importer = this.packImporter(importerId);
    if (!importer?.compendium) return 'no-such-importer';
    return this.begin(userId, importer, { kind: 'pack', declaration: importer.compendium });
  }

  /**
   * Uninstall a pack: delete its entries, then drop the Compendium Container itself, so the shelf stops
   * being installed rather than lingering empty at a revision nothing reflects. Adopted copies live in
   * a World and are untouched by either half (ADR-0079). A 409 while the pack is reconciling — the
   * delete would otherwise drop the Container out from under an insert still running.
   */
  async removePack(importerId: string): Promise<'ok' | 'no-such-importer'> {
    const importer = this.packImporter(importerId);
    if (!importer) return 'no-such-importer';
    await this.evict(importerId, () => {
      const row = compendiumByImporter(this.db, importerId);
      return row && { kind: 'compendium', containerId: row.id };
    });
    return 'ok';
  }

  // ---- the shared reconcile --------------------------------------------------

  /**
   * Take the scope, mark the job running, and let {@link run} finish behind the response. The one
   * place "only ever one reconcile per scope" is stated: a run in flight, or a run or remove mid-yield
   * against the same scope from anywhere, refuses a start (409).
   */
  private begin(ownerId: string, importer: Importer, site: RunSite): ImportRunSummary {
    const scope = this.scopeOf(importer, site);
    if (this.jobs.get(scope)?.status === 'running' || this.reconciling.has(scope))
      throw new ConflictException({ code: ImporterErrorCode.ImportRunning });
    this.jobs.set(scope, { ...IDLE, importer: importer.id, status: 'running', startedAt: Date.now() });
    this.reconciling.add(scope);
    // Deliberately not awaited: the reconcile outlives the request that asked for it.
    void this.run(ownerId, importer, site, scope);
    return this.jobs.get(scope) as ImportRunSummary;
  }

  /**
   * Delete everything the provenance index attributes to a target, in yielding chunks (ADR-0046), and
   * hand the emptied target back to the caller to finish with. Held under {@link reconciling} for the
   * same reason a run is: this loop yields between commits, so a concurrent start must see it.
   *
   * A target that was never installed is nothing to evict — the same no-op as an Importer that has
   * produced nothing into this World.
   */
  private async evict(scope: string, resolve: () => ReconcileTarget | undefined): Promise<void> {
    if (this.jobs.get(scope)?.status === 'running' || this.reconciling.has(scope))
      throw new ConflictException({ code: ImporterErrorCode.ImportRunning });
    this.reconciling.add(scope);
    try {
      const target = resolve();
      if (!target) return;
      const ids = this.provenanceRows(target).map((row) => row.entityId);
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
  }

  /**
   * Drive one run to completion behind the response. Only a fault in the Importer's fetch or a chunk's
   * *write* reaches the catch (→ `failed`); an ill-shaped Record is collected as a skip and the run
   * carries on. Yields before the first chunk (an `async` fn runs synchronously to its first `await`),
   * so a small World is not wholly reconciled before the POST returns.
   */
  private async run(ownerId: string, importer: Importer, site: RunSite, scope: string): Promise<void> {
    try {
      await yieldToEventLoop();
      const { rev, records } = await importer.produce({});
      // Resolved only once the `rev` is known: installing a pack *is* recording the revision it landed
      // at, so a run that never got past its fetch installs nothing (ADR-0079).
      const target = this.resolveTarget(importer, site, rev);
      const { ops, skipped, total } = this.plan(ownerId, target, importer.id, rev, records);
      // Record the pinned rev the moment it is known, so a poll mid-run — and the finished status line — carries it.
      this.jobs.set(scope, { ...(this.jobs.get(scope) as ImportRunSummary), rev, total, skipped });
      for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
        const chunk = ops.slice(i, i + CHUNK_SIZE);
        this.apply(chunk);
        const job = this.jobs.get(scope) as ImportRunSummary;
        this.jobs.set(scope, {
          ...job,
          created: job.created + chunk.filter((op) => op.kind === 'create').length,
          updated: job.updated + chunk.filter((op) => op.kind === 'update').length,
          deleted: job.deleted + chunk.filter((op) => op.kind === 'delete').length,
        });
        await yieldToEventLoop();
      }
      this.jobs.set(scope, {
        ...(this.jobs.get(scope) as ImportRunSummary),
        status: 'succeeded',
        finishedAt: Date.now(),
      });
    } catch (err) {
      this.jobs.set(scope, {
        ...(this.jobs.get(scope) as ImportRunSummary),
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
   *
   * Nothing here chooses a **Visibility**: a created Entity takes the schema default and a reimport
   * leaves the stored one alone, because a shelf uniform across the Instance has nothing per-run to
   * choose (ADR-0079).
   */
  private plan(
    ownerId: string,
    target: ReconcileTarget,
    importer: string,
    rev: string,
    records: readonly ImportRecord[],
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
          input: { name: record.name, types: record.types, tags: [], document },
        });
      } else {
        ops.push({
          kind: 'create',
          input: {
            ownerId,
            containerId: target.containerId,
            name: record.name,
            types: record.types,
            tags: [],
            document,
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
   * Where a run lands, installing the pack if this is its first (ADR-0079). A World run targets the
   * World it was asked for, exactly as before; a pack run targets the pack's own Compendium, minted
   * here — and re-captured, `rev` and attribution alike, on every reimport, so the shelf always states
   * the revision its entries actually reflect.
   */
  private resolveTarget(importer: Importer, site: RunSite, rev: string): ReconcileTarget {
    if (site.kind === 'world') return worldTarget(site.worldId, importer.id);
    return { kind: 'compendium', containerId: this.compendiums.install(importer.id, site.declaration, rev) };
  }

  /**
   * What a reconcile serializes on. A World run writes into the World it was asked for, so the World is
   * the scope, as it always was. A **pack** run writes into a Container the whole Instance shares, so
   * the Importer's own id is the scope — one pack has one producer (ADR-0079), and the id is stable
   * even before a first run has minted a Container to name instead.
   */
  private scopeOf(importer: Importer, site: RunSite): string {
    return site.kind === 'world' ? site.worldId : importer.id;
  }

  /** The Importer behind a World-surface call, or undefined when it is unknown *or* a pack (both 404). */
  private worldImporter(importerId: string): Importer | undefined {
    const importer = this.registry.get(importerId);
    return importer?.compendium ? undefined : importer;
  }

  /** The Importer behind a pack-surface call, or undefined when it is unknown *or* not a pack (both 404). */
  private packImporter(importerId: string): Importer | undefined {
    const importer = this.registry.get(importerId);
    return importer?.compendium ? importer : undefined;
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

/** An Importer as either panel names it: its id, and the copy to show — the label falling back to the id. */
function toSummary(importer: Importer): ImporterSummary {
  return { id: importer.id, label: importer.label ?? importer.id };
}

/** What one Importer owns inside one World — the `(container, importer)` half of the match key. */
function worldTarget(worldId: string, importer: string): ReconcileTarget {
  return { kind: 'world', containerId: worldId, importer };
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
  return target.kind === 'compendium'
    ? inContainer
    : and(inContainer, eq(entityImportSource.importer, target.importer));
}

/** Why a Record is unlandable, or `undefined` when it is well-shaped — the skip reason the run tallies. */
function invalidReason(record: ImportRecord): string | undefined {
  if (typeof record.sourceId !== 'string' || record.sourceId.length === 0) return 'missing-source-id';
  if (!nameSchema.safeParse(record.name).success) return 'invalid-name';
  if (!typesSchema.safeParse(record.types).success) return 'invalid-types';
  return undefined;
}
