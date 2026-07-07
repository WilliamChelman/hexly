import { randomUUID } from 'node:crypto';
import { Inject, Injectable, MessageEvent } from '@nestjs/common';
import { Subject } from 'rxjs';
import { InterestRef, NudgeDelta, NudgeEntry } from '@hexly/domain';
import { entityAccess } from '../acl/entity-access';
import { DB, Db } from '../db/db';

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
  principal: string;
  interest: InterestRef[];
  stream: Subject<MessageEvent>;
}

/** The outcome of an interest write — the controller maps this to a status code. */
export type InterestOutcome = 'ok' | 'forbidden' | 'not-found';

@Injectable()
export class NudgeBus {
  private readonly connections = new Map<string, Connection>();

  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Register a new connection for `principal`, minting an unguessable `connectionId`. The
   * returned `stream` is what the SSE handler pipes to the client; nudges are pushed onto it.
   */
  connect(principal: string): { connectionId: string; stream: Subject<MessageEvent> } {
    const connectionId = randomUUID();
    const stream = new Subject<MessageEvent>();
    this.connections.set(connectionId, { principal, interest: [], stream });
    return { connectionId, stream };
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
  setInterest(connectionId: string, principal: string, refs: InterestRef[]): InterestOutcome {
    const conn = this.connections.get(connectionId);
    if (!conn) return 'not-found';
    if (conn.principal !== principal) return 'forbidden';
    const access = entityAccess(this.db, principal);
    // World refs pass through unfiltered: nothing emits for Worlds yet (#171 later slice).
    conn.interest = refs.filter(
      (ref) => ref.kind !== 'entity' || !!access.decideMeta(ref.id)?.canRead,
    );
    return 'ok';
  }

  /**
   * Emit a change for an Entity to every connection subscribed to it. The nudge is a delta
   * carrying only the changed resource (ADR-0044); `version` lets a tab already at that version
   * ignore the echo.
   *
   * Each recipient's entry is shaped against their own *current* rights — the cheap boolean
   * reachability check on the single access seam (ADR-0044). Still-readable →
   * `{ id, version, updatedAt }`; access ended (private flip, revoked grant, deleted row) →
   * opaque `{ id, unavailable }`. The entry is memoized per principal, so N tabs of one user
   * cost one access resolution per emit, not N.
   */
  emitEntityChange(id: string, version: number, updatedAt: number): void {
    const byPrincipal = new Map<string, NudgeEntry>();
    for (const conn of this.connections.values()) {
      if (!conn.interest.some((ref) => ref.kind === 'entity' && ref.id === id)) continue;
      let entry = byPrincipal.get(conn.principal);
      if (!entry) {
        const canRead = !!entityAccess(this.db, conn.principal).decideMeta(id)?.canRead;
        entry = canRead ? { id, version, updatedAt } : { id, unavailable: true };
        byPrincipal.set(conn.principal, entry);
      }
      const delta: NudgeDelta = [entry];
      conn.stream.next({ type: 'nudge', data: delta });
    }
  }
}
