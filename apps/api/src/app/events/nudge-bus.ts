import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  MessageEvent,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Subject } from 'rxjs';
import { eq } from 'drizzle-orm';
import { InterestRef, NudgeDelta, NudgeEntry } from '@hexly/domain';
import { entityAccess, tokenReachesEntity } from '../acl/entity-access';
import { worldAccess, tokenReachesWorld } from '../acl/world-access';
import { worlds } from '../db/schema';
import { DB, Db } from '../db/db';
import { HEXLY_CONFIG, HexlyConfig } from '../config/config.module';

/**
 * The principal that opened a connection (ADR-0044, #175). Either a signed-in user (cookie) or
 * an anonymous **Public Link token** — the token *is* the grant, there is no anonymous user
 * object. Reachability resolves the same single access seam for both ({@link canRead}), which is
 * what makes an anonymous Public Link viewer a first-class live-follow participant.
 */
export type Principal =
  | { kind: 'user'; userId: string }
  | { kind: 'token'; token: string };

/** A stable key identifying a principal, so per-emit shaping can memoize one entry per recipient. */
function principalKey(p: Principal): string {
  return p.kind === 'user' ? `user:${p.userId}` : `token:${p.token}`;
}

/** Same principal (owns-the-connection check for the interest PUT). */
function principalsEqual(a: Principal, b: Principal): boolean {
  return principalKey(a) === principalKey(b);
}

/**
 * The in-process nudge bus (ADR-0044, #173/#174). Fan-out is a per-connection rxjs `Subject`,
 * and the server holds only an in-memory `Map<connectionId → {principal, interest, stream}>` —
 * justified by the single-process Instance (ADR-0036). A multi-process Instance would need a
 * shared broker (out of scope while ADR-0036 holds).
 *
 * Emit-time ACL shapes the payload per recipient — it does not gate recipients (ADR-0044):
 * every subscriber of the changed ref gets an entry computed against *their own current* rights,
 * which is what delivers live eviction. Re-filtering recipients instead would silently break it.
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
   * Start the shared heartbeat once the app is up (#177). One timer for every connection, not one
   * per stream. `unref()` so an idle heartbeat can't hold the process open. The timer never runs in
   * a unit test (it constructs the bus directly, skipping the Nest lifecycle) — {@link heartbeat}
   * is the seam those tests drive.
   */
  onModuleInit(): void {
    this.timer = setInterval(() => this.heartbeat(), this.heartbeatMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Push a heartbeat frame onto every open stream (#177). Its purpose is liveness, not data: a
   * client ignores the unlistened `heartbeat` event, and a write to a dead half-open socket
   * surfaces the close so the existing `finalize` reaps it — so the map can't grow unbounded over
   * uptime without a separate reaper.
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
   * Register a new connection for `principal`, minting an unguessable `connectionId`. The
   * returned `stream` is what the SSE handler pipes to the client; nudges are pushed onto it.
   */
  connect(principal: Principal): { connectionId: string; stream: Subject<MessageEvent> } {
    const connectionId = randomUUID();
    const stream = new Subject<MessageEvent>();
    this.connections.set(connectionId, { principal, interest: [], stream });
    return { connectionId, stream };
  }

  /**
   * Whether a principal can currently read Entity `id` — the boolean reachability seam shared by
   * subscribe-time filtering and per-emit shaping (ADR-0044). A cookie principal resolves the
   * ADR-0037 rule via {@link entityAccess}; a token principal resolves the Public Link grant.
   */
  private canRead(principal: Principal, id: string): boolean {
    return principal.kind === 'user'
      ? !!entityAccess(this.db, principal.userId).decideMeta(id)?.canRead
      : tokenReachesEntity(this.db, principal.token, id);
  }

  /**
   * Whether a principal can currently reach World `id` — the World peer of {@link canRead}. A
   * cookie principal resolves the same `reachableBy` rule the worlds-list read uses (member row OR
   * any Entity grant inside the World); a token principal resolves its World Public Link grant
   * (ADR-0044, #178), so an anonymous World-link viewer follows the open Dashboard live and a
   * revoked link reaches nothing.
   */
  private canReadWorld(principal: Principal, id: string): boolean {
    return principal.kind === 'user'
      ? !!worldAccess(this.db, principal.userId).decideMeta(id)?.reachable
      : tokenReachesWorld(this.db, principal.token, id);
  }

  /** Reachability for either ref kind — the shared seam for subscribe-time filtering and shaping. */
  private canReach(principal: Principal, ref: InterestRef): boolean {
    return ref.kind === 'entity'
      ? this.canRead(principal, ref.id)
      : this.canReadWorld(principal, ref.id);
  }

  /** Drop a connection (client closed the stream). Completes the stream so nothing leaks. */
  disconnect(connectionId: string): void {
    const conn = this.connections.get(connectionId);
    if (!conn) return;
    conn.stream.complete();
    this.connections.delete(connectionId);
  }

  /**
   * Replace a connection's *whole* interest set (ADR-0044): idempotent, client-owned. Authorized
   * to the same principal that opened the connection — the `connectionId` is unguessable *and*
   * ownership-checked, so one tab cannot set another's interest.
   *
   * A forbidden or nonexistent entity ref is *silently* not-subscribed (ADR-0044): the write
   * still succeeds, so existence can't be probed by subscribing to guessed ids — a recipient
   * only ever hears about resources it could read when it subscribed.
   */
  setInterest(connectionId: string, principal: Principal, refs: InterestRef[]): InterestOutcome {
    const conn = this.connections.get(connectionId);
    if (!conn) return 'not-found';
    if (!principalsEqual(conn.principal, principal)) return 'forbidden';
    // A forbidden or nonexistent ref of either kind is silently not-subscribed, so existence
    // can't be probed by guessing ids — a recipient only hears about what it could reach.
    conn.interest = refs.filter((ref) => this.canReach(principal, ref));
    return 'ok';
  }

  /**
   * The shared fan-out (ADR-0044): to every connection whose interest matches `matches`, push a
   * per-recipient-shaped delta. The shaping invariant — *shape the payload per recipient, never
   * filter recipients* — lives here once so Entity and World emits can't drift apart. `shape` is
   * memoized per principal, so N tabs of one user cost one access resolution per emit, not N.
   */
  private fanOut(
    matches: (ref: InterestRef) => boolean,
    shape: (principal: Principal) => NudgeEntry,
  ): void {
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
   * Emit a change for an Entity to every subscriber (ADR-0044). Still-readable →
   * `{ id, version, updatedAt }`; access ended (private flip, revoked grant, deleted row) → opaque
   * `{ id, unavailable }`. `version`/`updatedAt` let a tab already at that state ignore the echo.
   */
  emitEntityChange(id: string, version: number, updatedAt: number): void {
    this.fanOut(
      (ref) => ref.kind === 'entity' && ref.id === id,
      (principal) =>
        this.canRead(principal, id)
          ? { id, version, updatedAt }
          : { id, unavailable: true },
    );
  }

  /**
   * Emit a change for a World to every subscriber (ADR-0044, #176) — the World peer of
   * {@link emitEntityChange}. Still-reachable → `{ id, updatedAt }`; access ended (member removed,
   * World deleted) → opaque `{ id, unavailable }`. The `updatedAt` read is guarded behind a
   * follower check, so the common no-followers emit costs one interest scan and no query; a deleted
   * World simply has no row and shapes everyone to `unavailable`.
   */
  emitWorldChange(id: string): void {
    const matches = (ref: InterestRef) => ref.kind === 'world' && ref.id === id;
    if (!this.anyFollower(matches)) return;
    const row = this.db
      .select({ updatedAt: worlds.updatedAt })
      .from(worlds)
      .where(eq(worlds.id, id))
      .get();
    this.fanOut(matches, (principal) =>
      row && this.canReadWorld(principal, id)
        ? { id, updatedAt: row.updatedAt }
        : { id, unavailable: true },
    );
  }
}
