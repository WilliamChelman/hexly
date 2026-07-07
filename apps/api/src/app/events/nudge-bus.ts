import { randomUUID } from 'node:crypto';
import { Injectable, MessageEvent } from '@nestjs/common';
import { Subject } from 'rxjs';
import { InterestRef, NudgeDelta } from '@hexly/domain';

/**
 * The in-process nudge bus (ADR-0044, #173). Fan-out is a per-connection rxjs `Subject`, and the
 * server holds only an in-memory `Map<connectionId → {principal, interest, stream}>` — justified
 * by the single-process Instance (ADR-0036). A multi-process Instance would need a shared broker
 * (out of scope while ADR-0036 holds).
 *
 * Spine slice: fan-out is unconditional to every subscriber of a ref — everyone subscribed is an
 * authorized reader. Per-recipient ACL payload shaping (`unavailable`/eviction) is a later slice
 * (#171): it hangs off {@link emitEntityChange}, one reachability check per subscriber.
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
   */
  setInterest(connectionId: string, principal: string, refs: InterestRef[]): InterestOutcome {
    const conn = this.connections.get(connectionId);
    if (!conn) return 'not-found';
    if (conn.principal !== principal) return 'forbidden';
    conn.interest = refs;
    return 'ok';
  }

  /**
   * Emit a change for an Entity to every connection subscribed to it. The nudge is a delta
   * carrying only the changed resource (ADR-0044); `version` lets a tab already at that version
   * ignore the echo.
   */
  emitEntityChange(id: string, version: number): void {
    const delta: NudgeDelta = [{ id, version }];
    for (const conn of this.connections.values()) {
      if (conn.interest.some((ref) => ref.kind === 'entity' && ref.id === id)) {
        conn.stream.next({ type: 'nudge', data: delta });
      }
    }
  }
}
