import { Inject, Injectable } from '@nestjs/common';
import { DB, Db } from '../db/db';
import { NudgeBus } from './nudge-bus';

/**
 * A callback's return type, or `never` if it is a Promise — the shape that makes an async
 * {@link WriteOutbox.transact} callback a *type* error rather than a convention. `T` infers from
 * the naked occurrence in the false branch, so an `async` argument infers `T = Promise<…>`, the
 * conditional collapses to `never`, and the argument has nowhere to land.
 */
export type SyncOnly<T> = T extends Promise<unknown> ? never : T;

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

/** Fails to compile unless `T` is exactly `true`. */
type Assert<T extends true> = T;

/**
 * Compile-time proof of the above, compiled by the `build` target (which typechecks, unlike the
 * spec run — vitest strips types). Loosen {@link SyncOnly} and CI goes red *here*, rather than
 * silently in production the day a stray `await` mid-transaction races the outbox.
 */
export type TransactRejectsAsync = [
  Assert<Equal<SyncOnly<Promise<number>>, never>>,
  Assert<Equal<SyncOnly<void>, void>>,
  Assert<Equal<SyncOnly<number>, number>>,
];

/**
 * The outermost transaction and the post-commit nudge buffer, shared by every write handle
 * (ADR-0045). It exists as its own seam because a single user action can move both kinds — a World
 * membership change bumps the World *and* every shared Entity in it — and those nudges must flush
 * from **one** commit, in one buffer, or a rollback would strand half of them.
 *
 * Nudges queue post-commit: emitting inside the transaction would tell followers to refetch a
 * version a rollback then erased, and because their held `seq` never advanced, nothing later would
 * correct it. The buffer is a plain array on a Nest singleton, which is safe *only* because
 * `better-sqlite3` is synchronous — hence {@link transact} rejects async callbacks at the type
 * level rather than by convention.
 *
 * Ids are deduplicated on flush: one user action may touch the same resource more than once (a
 * nested `mutate`, an Entity that is both renamed and re-shared), and a follower learns nothing
 * from the second byte-identical `{ id, seq }` frame.
 */
@Injectable()
export class WriteOutbox {
  /** Entity ids nudged once the outermost transaction commits; dropped wholesale on rollback. */
  private readonly entityIds: string[] = [];
  /** World ids, likewise. */
  private readonly worldIds: string[] = [];
  /** Transaction nesting depth — only the outermost owns the commit and the flush. */
  private depth = 0;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly bus: NudgeBus,
  ) {}

  /**
   * Run `fn` in the outermost transaction, flushing the nudge buffer on commit and dropping it on
   * rollback. Re-entrant: a nested call joins the open transaction rather than opening another, so
   * a World delete that cascades its Entities commits — and nudges — exactly once.
   *
   * {@link SyncOnly} makes an async callback a *type* error, not a convention: one `await`
   * mid-transaction and the singleton's buffers become a cross-request data race.
   */
  transact<T>(fn: () => SyncOnly<T>): T {
    if (this.depth > 0) return fn() as T;
    this.depth++;
    try {
      const result = this.db.transaction(() => fn()) as T;
      // Committed: the rows followers will refetch are durable, so the buffer may drain.
      this.flush();
      return result;
    } catch (err) {
      // Rolled back: the writes never landed, so neither may the nudges. A follower told to
      // refetch an erased version would advance its held `seq` past reality and then ignore the
      // real change, staying stale with nothing left to correct it.
      this.discard();
      throw err;
    } finally {
      this.depth--;
    }
  }

  /**
   * Queue an Entity nudge. Every call sits inside the open transaction, so the id is either
   * flushed by the commit or dropped by the rollback — never emitted for a write that vanished.
   */
  entity(id: string): void {
    this.entityIds.push(id);
  }

  /** Queue a World nudge, on the same commit-or-drop terms as {@link entity}. */
  world(id: string): void {
    this.worldIds.push(id);
  }

  /**
   * Drain both buffers onto the bus, post-commit. Worlds first: a membership change that evicts a
   * principal should blank their Dashboard before the Entities under it, so the eviction reads as
   * one event rather than a cascade of unavailable tiles.
   */
  private flush(): void {
    const worlds = new Set(this.worldIds);
    const entities = new Set(this.entityIds);
    this.discard();
    for (const id of worlds) this.bus.emitWorldChange(id);
    for (const id of entities) this.bus.emitEntityChange(id);
  }

  private discard(): void {
    this.entityIds.length = 0;
    this.worldIds.length = 0;
  }
}
