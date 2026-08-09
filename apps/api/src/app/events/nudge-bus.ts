import { randomUUID } from 'node:crypto';
import { Inject, Injectable, MessageEvent, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subject } from 'rxjs';
import { eq } from 'drizzle-orm';
import { InterestRef, NudgeDelta, NudgeEntry } from '@hexly/domain';
import { entityAccess } from '../acl/entity-access';
import { worldAccess } from '../acl/world-access';
import { containers, entities, worlds } from '../db/schema';
import { DB, Db } from '../db/db';
import { HEXLY_CONFIG, HexlyConfig } from '../config';

/**
 * The principal that opened a connection: a signed-in user (session cookie). Since ADR-0084 retired
 * the anonymous read path there is no token principal — no read is ever anonymous, so the bus only
 * ever follows for a cookie-authenticated user ({@link canRead}).
 */
export type Principal = { kind: 'user'; userId: string };

/** A stable key identifying a principal, so per-emit shaping can memoize one entry per recipient. */
function principalKey(p: Principal): string {
  return `user:${p.userId}`;
}

/** Same principal (owns-the-connection check for the interest PUT). */
function principalsEqual(a: Principal, b: Principal): boolean {
  return principalKey(a) === principalKey(b);
}

/**
 * State of the in-process nudge bus: connections live only in memory, which assumes the
 * single-process Instance of ADR-0036 (a multi-process Instance needs a shared broker).
 *
 * Emit-time ACL shapes the payload per recipient — it does not gate recipients (ADR-0044):
 * every subscriber of the changed ref gets an entry computed against *their own current* rights.
 * That is what delivers live eviction; re-filtering recipients would silently break it.
 */
interface Connection {
  principal: Principal;
  interest: InterestRef[];
  stream: Subject<MessageEvent>;
}

/** The outcome of an interest write — the controller maps this to a status code. */
export type InterestOutcome = 'ok' | 'forbidden' | 'not-found';

@Injectable()
export class NudgeBus implements OnModuleInit, OnModuleDestroy {
  private readonly connections = new Map<string, Connection>();
  private timer: ReturnType<typeof setInterval> | undefined;
  /** Heartbeat cadence in ms, from the Instance Configuration (`liveFollow.heartbeatSeconds`, #177). */
  private readonly heartbeatMs: number;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(HEXLY_CONFIG) config: HexlyConfig,
  ) {
    this.heartbeatMs = config.liveFollow.heartbeatSeconds * 1000;
  }

  /**
   * One shared timer for all connections, not one per stream. `unref()` so an idle heartbeat can't
   * hold the process open. Unit tests construct the bus directly and drive {@link heartbeat}.
   */
  onModuleInit(): void {
    this.timer = setInterval(() => this.heartbeat(), this.heartbeatMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Liveness, not data: a client ignores the unlistened `heartbeat` event, and a write to a dead
   * half-open socket surfaces the close so `finalize` reaps the connection — which is what keeps
   * the map from growing unbounded without a separate reaper.
   */
  heartbeat(): void {
    for (const conn of this.connections.values()) {
      conn.stream.next({ type: 'heartbeat', data: {} });
    }
  }

  /** Live connection count — the "no unbounded growth" invariant, observable for a reap test (#177). */
  connectionCount(): number {
    return this.connections.size;
  }

  /**
   * Registers a connection with an unguessable `connectionId`. The returned `stream` is what the
   * SSE handler pipes to the client; nudges are pushed onto it.
   */
  connect(principal: Principal): {
    connectionId: string;
    stream: Subject<MessageEvent>;
  } {
    const connectionId = randomUUID();
    const stream = new Subject<MessageEvent>();
    this.connections.set(connectionId, { principal, interest: [], stream });
    return { connectionId, stream };
  }

  /**
   * Whether a principal can *currently* read Entity `id` — the ADR-0037/0084 rule via
   * {@link entityAccess}, resolved against the cookie principal's live rights.
   */
  private canRead(principal: Principal, id: string): boolean {
    return !!entityAccess(this.db, principal.userId).decideMeta(id)?.canRead;
  }

  /**
   * Whether a principal can *currently* reach World `id` — the World peer of {@link canRead}, the
   * same `reachableBy` rule the worlds-list read uses (member row OR any Entity grant inside the
   * World OR an Open World, ADR-0084).
   */
  private canReadWorld(principal: Principal, id: string): boolean {
    return !!worldAccess(this.db, principal.userId).decideMeta(id)?.reachable;
  }

  /** Reachability for either ref kind — the shared seam for subscribe-time filtering and shaping. */
  private canReach(principal: Principal, ref: InterestRef): boolean {
    return ref.kind === 'entity' ? this.canRead(principal, ref.id) : this.canReadWorld(principal, ref.id);
  }

  /** Drop a connection (client closed the stream). Completes the stream so nothing leaks. */
  disconnect(connectionId: string): void {
    const conn = this.connections.get(connectionId);
    if (!conn) return;
    conn.stream.complete();
    this.connections.delete(connectionId);
  }

  /**
   * Replaces a connection's *whole* interest set: idempotent, and authorized to the same principal
   * that opened the connection, so one tab cannot set another's interest.
   *
   * A forbidden or nonexistent ref is *silently* not-subscribed and the write still succeeds, so
   * existence can't be probed by subscribing to guessed ids.
   */
  setInterest(connectionId: string, principal: Principal, refs: InterestRef[]): InterestOutcome {
    const conn = this.connections.get(connectionId);
    if (!conn) return 'not-found';
    if (!principalsEqual(conn.principal, principal)) return 'forbidden';
    conn.interest = refs.filter((ref) => this.canReach(principal, ref));
    return 'ok';
  }

  /**
   * Pushes a delta to every connection whose interest matches, shaped per recipient — *shape the
   * payload, never filter recipients* (ADR-0044). `shape` is memoized per principal, so N tabs of
   * one user cost one access resolution per emit, not N.
   */
  private fanOut(matches: (ref: InterestRef) => boolean, shape: (principal: Principal) => NudgeEntry): void {
    const byPrincipal = new Map<string, NudgeEntry>();
    for (const conn of this.connections.values()) {
      if (!conn.interest.some(matches)) continue;
      const key = principalKey(conn.principal);
      let entry = byPrincipal.get(key);
      if (!entry) {
        entry = shape(conn.principal);
        byPrincipal.set(key, entry);
      }
      const delta: NudgeDelta = [entry];
      conn.stream.next({ type: 'nudge', data: delta });
    }
  }

  /** Whether any live connection is watching `ref` — lets an emit skip all work when nobody follows. */
  private anyFollower(matches: (ref: InterestRef) => boolean): boolean {
    for (const conn of this.connections.values()) {
      if (conn.interest.some(matches)) return true;
    }
    return false;
  }

  /**
   * Still-readable → `{ id, seq }`; access ended (private flip, revoked grant, deleted row) →
   * opaque `{ id, unavailable }`. A missing row is not an error but the eviction path: a
   * cascade-deleted Entity fans out `unavailable`.
   */
  emitEntityChange(id: string): void {
    const matches = (ref: InterestRef) => ref.kind === 'entity' && ref.id === id;
    // The common case is nobody following: one interest scan, no query.
    if (!this.anyFollower(matches)) return;
    const row = this.db.select({ seq: entities.seq }).from(entities).where(eq(entities.id, id)).get();
    this.fanOut(matches, (principal) =>
      row && this.canRead(principal, id) ? { id, seq: row.seq } : { id, unavailable: true },
    );
  }

  /**
   * The World peer of {@link emitEntityChange}. Still-reachable → `{ id, seq }`; access ended
   * (member removed, World deleted) → opaque `{ id, unavailable }`.
   */
  emitWorldChange(id: string): void {
    const matches = (ref: InterestRef) => ref.kind === 'world' && ref.id === id;
    if (!this.anyFollower(matches)) return;
    // The freshness key lives on the Container (ADR-0078); the join keeps a world ref World-only.
    const row = this.db
      .select({ seq: containers.seq })
      .from(worlds)
      .innerJoin(containers, eq(containers.id, worlds.id))
      .where(eq(worlds.id, id))
      .get();
    this.fanOut(matches, (principal) =>
      row && this.canReadWorld(principal, id) ? { id, seq: row.seq } : { id, unavailable: true },
    );
  }
}
