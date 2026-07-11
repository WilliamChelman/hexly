import { ConflictException } from '@nestjs/common';
import { createDb, Db } from '../db/db';
import { ReindexChunk } from '../entities/entity-writes';
import { AdminService } from './admin.service';

/**
 * The Reindex job (ADR-0046, #180). `EntityWrites.reindexChunk` is a stub here on purpose: what
 * this spec is about is the *job* — that the walk leaves the request, that it paces itself across
 * chunks, that a bad document is reported rather than fatal, and that only one runs at a time.
 * The walk's own correctness is `EntityWrites`' spec.
 */
describe('AdminService — the Reindex job', () => {
  let db: Db;
  let chunks: ReindexChunk[];
  let asked: (string | null)[];
  let service: AdminService;

  /** A stubbed walk: each call shifts the next scripted chunk off the queue. */
  const writes = {
    reindexChunk: (after: string | null): ReindexChunk => {
      asked.push(after);
      const next = chunks.shift();
      if (!next) throw new Error('reindexChunk called more times than the spec scripted');
      return next;
    },
  };

  const chunk = (c: Partial<ReindexChunk> = {}): ReindexChunk => ({
    walked: 0,
    reindexed: 0,
    failures: [],
    cursor: null,
    ...c,
  });

  beforeEach(() => {
    db = createDb(':memory:'); // Isolated per-test (ADR-0002). Only the entity count is read.
    chunks = [];
    asked = [];
    service = new AdminService(db, writes as never);
  });

  /**
   * A started walk outlives the call that started it, and the stub above is shared. Drain it, or
   * an orphan job resumes mid-way through the *next* test and eats the chunks it scripted.
   */
  afterEach(settle);

  /**
   * Turn the event loop until the job stops. The walk paces itself with `setImmediate` — one tick
   * per chunk, plus the one it yields before the first — so a single tick is never enough.
   */
  async function settle(): Promise<void> {
    for (let tick = 0; tick < 100 && service.status().status === 'running'; tick++)
      await new Promise((resolve) => setImmediate(resolve));
  }

  it('is idle before anything has run', () => {
    expect(service.status()).toMatchObject({ status: 'idle', walked: 0, startedAt: null });
  });

  /**
   * The whole point of the 202: `start` returns before a single row is touched. If the walk ran
   * inside the request, the client would be handed a finished job it never saw running — and on a
   * large instance the request would time out before it saw anything at all.
   */
  it('returns running before the walk has touched a row', () => {
    chunks = [chunk({ walked: 1, reindexed: 1 })];

    const job = service.start();

    expect(job.status).toBe('running');
    expect(asked).toEqual([]); // Not one chunk requested yet.
  });

  it('walks to exhaustion, following the cursor, and succeeds', async () => {
    chunks = [
      chunk({ walked: 2, reindexed: 2, cursor: 'e2' }),
      chunk({ walked: 2, reindexed: 2, cursor: 'e4' }),
      chunk({ walked: 1, reindexed: 1, cursor: null }),
    ];

    service.start();
    await settle();

    expect(asked).toEqual([null, 'e2', 'e4']);
    expect(service.status()).toMatchObject({ status: 'succeeded', walked: 5, reindexed: 5 });
    expect(service.status().finishedAt).not.toBeNull();
  });

  /**
   * A document this build cannot parse is a fact to report, not a fault to abort on: the walk
   * finishes, and the Superadmin gets the ids of what it could not read.
   */
  it('succeeds with failures collected across chunks, never aborting on a bad document', async () => {
    const bad = { entityId: 'broken', worldId: 'w1', reason: 'Unexpected token' };
    chunks = [
      chunk({ walked: 2, reindexed: 1, failures: [bad], cursor: 'e2' }),
      chunk({ walked: 1, reindexed: 1 }),
    ];

    service.start();
    await settle();

    expect(service.status()).toMatchObject({
      status: 'succeeded',
      walked: 3,
      reindexed: 2,
      failures: [bad],
    });
  });

  /** `failed` is reserved for a database that refused — never for content it could not read. */
  it('fails, and records why, when the write itself throws', async () => {
    chunks = [];
    const boom = {
      reindexChunk: () => {
        throw new Error('database is locked');
      },
    };
    service = new AdminService(db, boom as never);

    service.start();
    await settle();

    expect(service.status()).toMatchObject({ status: 'failed', error: 'database is locked' });
    expect(service.status().finishedAt).not.toBeNull();
  });

  /**
   * There is only ever one job: the walk is instance-wide, so a second concurrent run would
   * contend with the first for the same rows and discover nothing the first would not.
   */
  it('refuses to start a second walk while one is running', () => {
    chunks = [chunk({ walked: 1, reindexed: 1 })];

    service.start();

    expect(() => service.start()).toThrow(ConflictException);
  });

  it('starts again once the walk has finished', async () => {
    chunks = [chunk({ walked: 1, reindexed: 1 })];
    service.start();
    await settle();

    chunks = [chunk({ walked: 1, reindexed: 1 })];
    expect(service.start().status).toBe('running');
  });
});
