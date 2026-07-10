import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { count } from 'drizzle-orm';
import { AdminErrorCode, ReindexJob } from '@hexly/domain';
import { DB, Db } from '../db/db';
import { entities } from '../db/schema';
import { EntityWrites } from '../entities/entity-writes';

/**
 * Entities recomputed per transaction. The walk yields to the event loop between chunks, so this
 * is the granularity at which a Reindex stops monopolizing the process — small enough that a
 * chunk's synchronous transaction is imperceptible to a concurrent request, large enough that the
 * per-chunk overhead stays lost in the derivation cost.
 */
const CHUNK_SIZE = 200;

/** The state before any Reindex this process has seen. */
const IDLE: ReindexJob = {
  status: 'idle',
  total: 0,
  walked: 0,
  reindexed: 0,
  failures: [],
  startedAt: null,
  finishedAt: null,
  error: null,
};

/** Hand the event loop back, so a chunk's transaction is not the only thing this process does. */
const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * The Superadmin repair domain (ADR-0046, #180): the operator's tier, outside the collaboration
 * model, reaching content no Instance Admin may. Kept apart from {@link AdminService}, which stops
 * short of any World or Entity.
 *
 * Owns the instance's one Reindex job — one, because the walk is instance-wide. Job state lives on
 * this singleton, not a table: each chunk commits, so a restart just forgets an unfinished job
 * whose done chunks are already on disk.
 */
@Injectable()
export class SuperadminService {
  private job: ReindexJob = IDLE;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly writes: EntityWrites,
  ) {}

  /** Where the instance's Reindex stands. The poll target behind `GET /superadmin/reindex`. */
  status(): ReindexJob {
    return this.job;
  }

  /**
   * Start the walk and return at once, leaving it running behind the response — recomputing every
   * Entity's document-derived state: link edges, the `::` Link Descriptor vocabulary, and
   * `contentText` (whose `entities_fts` mirror follows via its sync triggers). The document is the
   * source of truth and the derived tables are a cache of it, so this is idempotent and safe to
   * run at any time.
   *
   * It is the general tool for applying a *future* document-derivation retroactively, which is why
   * nothing here names the derivations it rebuilds: adding one to `EntityWrites.derive` is enough
   * for this button to backfill it.
   */
  start(): ReindexJob {
    if (this.job.status === 'running')
      throw new ConflictException({ code: AdminErrorCode.ReindexRunning });
    this.job = { ...IDLE, status: 'running', total: this.countEntities(), startedAt: Date.now() };
    // Deliberately not awaited: the walk outlives the request that asked for it, and the client
    // follows it by polling. `run` never rejects — it lands every fault in the job itself.
    void this.run();
    return this.job;
  }

  /**
   * Drive {@link EntityWrites.reindexChunk} to exhaustion, yielding between chunks. Only a fault
   * in the *write* reaches the catch: a document this build cannot parse is collected as a
   * per-Entity failure and the walk carries on, so one corrupt row cannot deny the repair to the
   * instance that most needs it. `failed` therefore means the database refused, never that the
   * content was bad.
   */
  private async run(): Promise<void> {
    try {
      // Yield before the first chunk, not just between them: an `async` function runs
      // synchronously up to its first `await`, so without this the opening transaction would
      // execute inside `start()` — and a small instance would be wholly reindexed before the
      // POST returned, handing the client a job it never saw `running`.
      await yieldToEventLoop();
      let cursor: string | null = null;
      for (;;) {
        const chunk = this.writes.reindexChunk(cursor, CHUNK_SIZE);
        this.job = {
          ...this.job,
          walked: this.job.walked + chunk.walked,
          reindexed: this.job.reindexed + chunk.reindexed,
          failures: [...this.job.failures, ...chunk.failures],
        };
        if (chunk.cursor === null) break;
        cursor = chunk.cursor;
        await yieldToEventLoop();
      }
      this.job = { ...this.job, status: 'succeeded', finishedAt: Date.now() };
    } catch (err) {
      this.job = {
        ...this.job,
        status: 'failed',
        finishedAt: Date.now(),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** The denominator for progress, read once when the walk starts. */
  private countEntities(): number {
    return this.db.select({ n: count() }).from(entities).get()?.n ?? 0;
  }
}
