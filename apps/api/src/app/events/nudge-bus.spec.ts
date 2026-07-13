import type { MessageEvent } from '@nestjs/common';
import { createDb } from '../db/db';
import { loadConfig } from '../config/config';
import { NudgeBus, Principal } from './nudge-bus';

describe('NudgeBus connection layer', () => {
  const user = (id: string): Principal => ({ kind: 'user', userId: id });

  // Real default config (heartbeatSeconds 30) — the timer never starts in these tests (no
  // onModuleInit), so the value is inert; `heartbeat()` is the seam they drive directly.
  function bus() {
    return new NudgeBus(createDb(':memory:'), loadConfig(':memory:'));
  }

  it('pushes a heartbeat frame onto every open stream', () => {
    const b = bus();
    const a = b.connect(user('u1'));
    const c = b.connect(user('u2'));
    const aFrames: MessageEvent[] = [];
    const cFrames: MessageEvent[] = [];
    a.stream.subscribe((f) => aFrames.push(f));
    c.stream.subscribe((f) => cFrames.push(f));

    b.heartbeat();

    expect(aFrames).toEqual([{ type: 'heartbeat', data: {} }]);
    expect(cFrames).toEqual([{ type: 'heartbeat', data: {} }]);
  });

  it('drops a disconnected connection from the map, so it cannot grow unbounded', () => {
    const b = bus();
    expect(b.connectionCount()).toBe(0);
    const a = b.connect(user('u1'));
    expect(b.connectionCount()).toBe(1);

    // A closed stream (crashed tab / dropped socket → `finalize`) reaps its entry.
    b.disconnect(a.connectionId);
    expect(b.connectionCount()).toBe(0);
  });
});
