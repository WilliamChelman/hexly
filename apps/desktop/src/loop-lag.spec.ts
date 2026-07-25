import {
  DEFAULT_THRESHOLD_MS,
  describeLoopLag,
  LOOP_LAG_ENV,
  loopLagProbe,
  type LoopLagReading,
  loopLagSettings,
  MAX_LABEL_LENGTH,
  MAX_REPORTED_SUSPECTS,
  type RequestServer,
  requestLabel,
  startLoopLagProbe,
  watchRequests,
} from './loop-lag';

/**
 * A probe whose clock and whose delay readings a spec drives, instead of blocking a real event loop. No
 * slack by default, so a spec's arithmetic is the probe's arithmetic; the slack has a spec of its own.
 */
function probeAt(thresholdMs = 100, slackMs = 0) {
  const slack = () => slackMs;
  let clock = 1_000;
  const peaks: number[] = [];
  const reported: LoopLagReading[] = [];
  const probe = loopLagProbe({
    thresholdMs,
    slackMs: slack,
    peakDelayMs: () => peaks.shift() ?? 0,
    report: (reading) => reported.push(reading),
    now: () => clock,
  });
  return {
    probe,
    reported,
    /** Close a window that saw `peakMs` of delay. The clock is the spec's to advance. */
    sample(peakMs: number) {
      peaks.push(peakMs);
      probe.sample();
    },
    advance(ms: number) {
      clock += ms;
    },
    /** Work that occupied main for `ms` and then finished. */
    ran(label: string, ms: number) {
      const done = this.probe.during(label);
      this.advance(ms);
      done();
    },
  };
}

describe('loopLagProbe', () => {
  it('says nothing about a loop that kept up', () => {
    const run = probeAt(100);

    run.advance(1000);
    run.sample(22);

    expect(run.reported).toEqual([]);
  });

  it('reports the worst delay of the window it closed, and how long that window was', () => {
    const run = probeAt(100);

    run.advance(1002);
    run.sample(340);

    expect(run.reported).toEqual([{ peakMs: 340, windowMs: 1002, suspects: [], tooShort: 0 }]);
  });

  it('reports a delay that only just crosses the threshold', () => {
    const run = probeAt(100);

    run.advance(1000);
    run.sample(100);

    expect(run.reported).toHaveLength(1);
  });

  it('names work that was open long enough to have held the loop, and for how long it was', () => {
    const run = probeAt(100);

    run.ran('POST /api/worlds/import', 1400);
    run.advance(100);
    run.sample(1400);

    expect(run.reported[0].suspects).toEqual([{ label: 'POST /api/worlds/import', openMs: 1400 }]);
    expect(run.reported[0].tooShort).toBe(0);
  });

  it('exonerates work too short to have spanned the block, and counts it as the load around it', () => {
    const run = probeAt(100);

    run.ran('POST /api/worlds/import', 1400);
    run.ran('GET /fonts/marcellus.woff2', 4);
    run.ran('GET /api/worlds', 6);
    run.advance(100);
    run.sample(1400);

    expect(run.reported[0].suspects.map((suspect) => suspect.label)).toEqual(['POST /api/worlds/import']);
    expect(run.reported[0].tooShort).toBe(2);
  });

  it('puts the tightest fit first, so a live-follow stream never heads a report it merely appears in', () => {
    const run = probeAt(100);
    // Open for the whole window and never the cause of anything (ADR-0044).
    run.probe.during('GET /api/events');

    run.advance(400);
    run.ran('GET /api/entities/1', 150);
    run.advance(450);
    run.sample(120);

    expect(run.reported[0].suspects).toEqual([
      { label: 'GET /api/entities/1', openMs: 150 },
      { label: 'GET /api/events', openMs: 1000 },
    ]);
  });

  it('allows the peak the resolution it was measured at, so the real culprit is not exonerated by overhead', () => {
    const run = probeAt(100, 20);

    run.ran('GET /api/worlds', 290);
    run.advance(700);
    run.sample(305);

    expect(run.reported[0].suspects.map((suspect) => suspect.label)).toEqual(['GET /api/worlds']);
  });

  it('keeps the culprit of a block the size the baseline measured, whose peak it could not have matched', () => {
    const reported: LoopLagReading[] = [];
    let clock = 0;
    const probe = loopLagProbe({
      thresholdMs: 100,
      // The numbers off the #329 baseline run: a peak no request can account for to the millisecond, because
      // the delay carries the monitor's own sampling period (ADR-0070).
      peakDelayMs: () => 1514,
      report: (reading) => reported.push(reading),
      now: () => clock,
    });

    const done = probe.during('POST /api/worlds/import');
    clock += 1499;
    done();
    probe.sample();

    expect(reported[0].suspects).toEqual([{ label: 'POST /api/worlds/import', openMs: 1499 }]);
  });

  it('holds work still open to only the part of the window it was open for', () => {
    const run = probeAt(100);
    run.probe.during('boot');

    run.advance(600);
    run.sample(400);
    run.advance(1000);
    run.sample(400);

    expect(run.reported.map((reading) => reading.suspects)).toEqual([
      [{ label: 'boot', openMs: 600 }],
      [{ label: 'boot', openMs: 1000 }],
    ]);
  });

  it('forgets work that finished in an earlier window', () => {
    const run = probeAt(100);

    run.ran('boot', 900);
    run.sample(900);
    run.advance(1000);
    run.sample(900);

    expect(run.reported.map((reading) => reading.suspects.length)).toEqual([1, 0]);
    expect(run.reported[1].tooShort).toBe(0);
  });

  it('takes a second end of the same work as the same end', () => {
    const run = probeAt(100);
    const done = run.probe.during('GET /api/worlds');
    run.advance(300);
    done();
    run.advance(500);
    done();

    run.sample(300);

    expect(run.reported[0].suspects).toEqual([{ label: 'GET /api/worlds', openMs: 300 }]);
  });
});

describe('describeLoopLag', () => {
  it('says how bad it was, over how long, and what held it', () => {
    const reading = {
      peakMs: 1440.7,
      windowMs: 2337.3,
      suspects: [{ label: 'POST /api/worlds/import', openMs: 1402.6 }],
      tooShort: 0,
    };

    expect(describeLoopLag(reading)).toBe('event-loop lag 1441ms peak in 2337ms — POST /api/worlds/import 1403ms');
  });

  it('counts the load the block sat in, rather than listing every font of it', () => {
    const reading = {
      peakMs: 1440,
      windowMs: 2337,
      suspects: [{ label: 'POST /api/worlds/import', openMs: 1402 }],
      tooShort: 46,
    };

    expect(describeLoopLag(reading)).toBe(
      'event-loop lag 1440ms peak in 2337ms — POST /api/worlds/import 1402ms, +46 too short to have held it',
    );
  });

  it('says so when nothing main knows about could have held it, which is how background work shows itself', () => {
    expect(describeLoopLag({ peakMs: 320, windowMs: 1000, suspects: [], tooShort: 12 })).toBe(
      'event-loop lag 320ms peak in 1000ms — nothing was open long enough, +12 too short to have held it',
    );
  });

  it('says nothing at all was in flight when the window held nothing', () => {
    expect(describeLoopLag({ peakMs: 320, windowMs: 1000, suspects: [], tooShort: 0 })).toBe(
      'event-loop lag 320ms peak in 1000ms — nothing was open long enough',
    );
  });

  it('caps the list, because a line nobody can read is not a report', () => {
    const suspects = Array.from({ length: MAX_REPORTED_SUSPECTS + 3 }, (_, i) => ({
      label: `GET /api/entities/${i}`,
      openMs: 100 + i,
    }));

    const line = describeLoopLag({ peakMs: 320, windowMs: 1000, suspects, tooShort: 0 });

    expect(line).toContain('+3 more');
    expect(line).toContain('GET /api/entities/0');
    expect(line).not.toContain(`GET /api/entities/${MAX_REPORTED_SUSPECTS}`);
  });
});

describe('requestLabel', () => {
  it('names the route, without the query string that makes every request its own label', () => {
    expect(requestLabel('POST', '/api/worlds/import?x=1')).toBe('POST /api/worlds/import');
  });

  it('answers for a request whose method or url the server never gave us', () => {
    expect(requestLabel(undefined, undefined)).toBe('? ?');
  });

  it('truncates a very long path, which is a label nothing reads to the end of', () => {
    const label = requestLabel('GET', `/api/entities/${'a'.repeat(500)}`);

    expect(label).toBe(`GET ${`/api/entities/${'a'.repeat(500)}`.slice(0, MAX_LABEL_LENGTH)}…`);
  });
});

describe('watchRequests', () => {
  /** An `http.Server` stand-in: it emits one request and hands back the response to close. */
  function fakeServer() {
    const listeners: ((req: unknown, res: unknown) => void)[] = [];
    const server: RequestServer = {
      on(_event, listener) {
        listeners.push(listener as (req: unknown, res: unknown) => void);
        return server;
      },
    };
    return {
      server,
      serve(method: string, url: string) {
        const closers: (() => void)[] = [];
        const res = {
          on(_event: 'close', listener: () => void) {
            closers.push(listener);
            return res;
          },
        };
        for (const listener of listeners) listener({ method, url }, res);
        return () => closers.forEach((close) => close());
      },
    };
  }

  it('holds a request open for as long as the server is answering it', () => {
    const run = probeAt(100);
    const http = fakeServer();
    watchRequests(http.server, run.probe);

    const finish = http.serve('POST', '/api/worlds/import');
    run.advance(1400);
    run.sample(1400);
    run.advance(900);
    finish();
    run.advance(100);
    run.sample(900);
    run.advance(1000);
    run.sample(900);

    expect(run.reported.map((reading) => reading.suspects.map((suspect) => suspect.label))).toEqual([
      ['POST /api/worlds/import'],
      ['POST /api/worlds/import'],
      [],
    ]);
  });
});

describe('loopLagSettings', () => {
  it('is on, at the threshold the menu bar starts to feel', () => {
    expect(loopLagSettings({})).toEqual({ enabled: true, thresholdMs: DEFAULT_THRESHOLD_MS });
  });

  it('is turned off by a word a maintainer would guess', () => {
    for (const value of ['off', '0', 'false', 'OFF'])
      expect(loopLagSettings({ [LOOP_LAG_ENV]: value }).enabled).toBe(false);
  });

  it('takes a number as the threshold to report above, which is how a measuring run lowers it', () => {
    expect(loopLagSettings({ [LOOP_LAG_ENV]: '25' })).toEqual({ enabled: true, thresholdMs: 25 });
  });

  it('keeps the default rather than reading a value it cannot make sense of', () => {
    expect(loopLagSettings({ [LOOP_LAG_ENV]: 'yes please' })).toEqual({
      enabled: true,
      thresholdMs: DEFAULT_THRESHOLD_MS,
    });
  });
});

describe('startLoopLagProbe', () => {
  it('costs nothing when it is off: no timer, no histogram, and nothing recorded', () => {
    const reported: LoopLagReading[] = [];
    const probe = startLoopLagProbe({ enabled: false }, (reading) => reported.push(reading));

    probe.during('boot')();
    probe.sample();

    expect(reported).toEqual([]);
  });

  it('reports a real block of the real event loop, naming the work that held it', async () => {
    const reported: LoopLagReading[] = [];
    const probe = startLoopLagProbe({ enabled: true, thresholdMs: 100 }, (reading) => reported.push(reading));
    const arrived = new Promise<void>((resolve) => {
      const waiting = setInterval(() => reported.length && (clearInterval(waiting), resolve()), 50);
    });

    // Blocked from a timer callback, not from here: libuv starts the histogram's own timer when the loop
    // first runs, so a block in the synchronous pass before that is the one thing it cannot see.
    setTimeout(() => {
      const done = probe.during('busy');
      const until = Date.now() + 300;
      while (Date.now() < until) {
        // Spinning is the point: this is the shape `unzipSync` and a SQLite query take (ADR-0070).
      }
      done();
    }, 50);
    await arrived;

    expect(reported[0].peakMs).toBeGreaterThan(100);
    expect(reported[0].suspects.map((suspect) => suspect.label)).toContain('busy');
  }, 10_000);
});
