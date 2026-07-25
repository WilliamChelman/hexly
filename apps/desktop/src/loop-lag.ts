import { monitorEventLoopDelay } from 'node:perf_hooks';

/**
 * Main's loop serves every HTTP response as well as the windows, so this is the tripwire ADR-0070 left itself
 * for the `utilityProcess` decision (#329) — the ADR carries the reasoning and the measured baseline.
 *
 * One rule shapes every report here: a block is only observable once it is over, so there is no instant to
 * attribute it to, only the window it happened in — and a window holds dozens of activities. They are
 * narrowed by arithmetic rather than by a longer list, since the loop was held in one unbroken stretch and
 * anything open for less than that cannot have spanned it, then ranked tightest fit first.
 */

/** Read off `process.env`: `off` to silence it, or a number of milliseconds to report above. */
export const LOOP_LAG_ENV = 'HEXLY_LOOP_LAG';

/** Where the menu bar starts to feel it (ADR-0070) — so the default reports what a user could notice. */
export const DEFAULT_THRESHOLD_MS = 100;

/**
 * How often the peak is read. Coarse on purpose: the delay itself is measured by libuv at
 * {@link MONITOR_RESOLUTION_MS}, so a slower sample loses no block — it only widens the window a block is
 * attributed to.
 */
export const SAMPLE_INTERVAL_MS = 1000;

/** How often libuv times itself. Fine enough to catch a 100 ms block, coarse enough to cost nothing. */
export const MONITOR_RESOLUTION_MS = 20;

/**
 * How much of the peak an activity is allowed to be short by and still be a suspect, on top of
 * {@link MONITOR_RESOLUTION_MS}. Both numbers being compared are wall-clock measurements taken on a loaded
 * machine — the baseline run had the import open 1499 ms of a 1514 ms peak — so a tolerance that is only the
 * sampling period exonerates the true culprit about as often as not. Generous costs nothing: what the
 * comparison exists to drop is the dozens of requests answered in single-digit milliseconds.
 */
export const SUSPECT_SLACK = 0.1;

/** How many suspects a report names before it stops naming and starts counting. */
export const MAX_REPORTED_SUSPECTS = 4;

/** Longest path a label carries. An Entity id makes a path long; nothing reads the tail of it. */
export const MAX_LABEL_LENGTH = 120;

/** Whether the probe runs at all, and what it considers worth saying — off carries no threshold to read. */
export type LoopLagSettings = { readonly enabled: false } | { readonly enabled: true; readonly thresholdMs: number };

/**
 * How short of the peak an activity may fall and still be held a suspect: the delay libuv reports carries its
 * own sampling period, and neither measurement is exact (see {@link SUSPECT_SLACK}).
 */
export function suspectSlackMs(peakMs: number): number {
  return MONITOR_RESOLUTION_MS + peakMs * SUSPECT_SLACK;
}

/** Something that was open long enough to have held the loop for the whole block. */
export interface LoopLagSuspect {
  readonly label: string;
  /** How much of the window it was open for — clipped to the window, so windows never double-count. */
  readonly openMs: number;
}

/** One window in which the loop was held longer than it should have been. */
export interface LoopLagReading {
  /**
   * The worst delay libuv saw in the window, in milliseconds — which carries its own
   * {@link MONITOR_RESOLUTION_MS} sampling period, so the true block is up to that much shorter.
   */
  readonly peakMs: number;
  /** How long the window was — a sample interval, plus however late the lag made this sample. */
  readonly windowMs: number;
  /** What could have held it, tightest fit first. Empty means the block came from work main never labelled. */
  readonly suspects: readonly LoopLagSuspect[];
  /** How much else the window held, all of it too short to have caused the block — the load around it. */
  readonly tooShort: number;
}

export interface LoopLagProbe {
  /**
   * Mark `label` as occupying main until the returned function is called. Overlap and nesting are expected —
   * concurrent requests are the normal case — and a second call to the same ender is the same end.
   */
  during(label: string): () => void;
  /** Close the current window: read the worst delay in it and report it if it crossed the threshold. */
  sample(): void;
}

/** One activity's span, which is all that deciding whether it could have held the loop needs. */
interface Occupation {
  readonly label: string;
  readonly startedAt: number;
  endedAt?: number;
}

export interface LoopLagProbeOptions {
  /** The worst delay since this was last called, in milliseconds — reading it resets it. */
  peakDelayMs(): number;
  report(reading: LoopLagReading): void;
  readonly thresholdMs: number;
  /**
   * How much shorter than the peak an activity may be and still be a suspect — {@link suspectSlackMs} by
   * default, and `() => 0` for a spec doing exact arithmetic.
   */
  slackMs?(peakMs: number): number;
  /** A `Date.now`, so a spec drives the clock instead of waiting on it — as `throttleProgress` does (#326). */
  now?: () => number;
}

/**
 * The probe's decisions, with the event loop it watches held at arm's length: what counts as lag, and which
 * of the things main had in hand a window's lag is attributed to. {@link startLoopLagProbe} is the one that
 * owns a real histogram and a real timer.
 *
 * What this holds is bounded by the sample interval: one entry per activity in flight, plus one per activity
 * that finished since the last sample — because a finished one belongs to the window it finished in, and is
 * dropped as that window closes.
 */
export function loopLagProbe(options: LoopLagProbeOptions): LoopLagProbe {
  const now = options.now ?? Date.now;
  const slackMs = options.slackMs ?? suspectSlackMs;
  let occupations: Occupation[] = [];
  let windowOpenedAt = now();

  return {
    during(label) {
      const occupation: Occupation = { label, startedAt: now() };
      occupations.push(occupation);
      // Idempotent: `close` on a response can arrive twice, and the first end is the honest one.
      return () => void (occupation.endedAt ??= now());
    },

    sample() {
      const at = now();
      const peakMs = options.peakDelayMs();
      if (peakMs >= options.thresholdMs) {
        const suspects: LoopLagSuspect[] = [];
        const slack = slackMs(peakMs);
        let tooShort = 0;
        for (const occupation of occupations) {
          // Clipped to the window at both ends: what a longer-running activity did in *this* window is all
          // this window can hold it responsible for.
          const openMs = (occupation.endedAt ?? at) - Math.max(occupation.startedAt, windowOpenedAt);
          if (openMs + slack >= peakMs) suspects.push({ label: occupation.label, openMs });
          else tooShort++;
        }
        // Ascending: the smallest activity that was open long enough is the tightest explanation, and V8's
        // stable sort leaves equal spans in the order they arrived.
        suspects.sort((one, other) => one.openMs - other.openMs);
        options.report({ peakMs, windowMs: at - windowOpenedAt, suspects, tooShort });
      }
      // Whatever finished belongs to the window just closed; the next one can only be held by what is open.
      occupations = occupations.filter((occupation) => occupation.endedAt === undefined);
      windowOpenedAt = at;
    },
  };
}

/** One line: a report is read in a terminal beside every other line main writes. */
export function describeLoopLag(reading: LoopLagReading): string {
  const named = reading.suspects
    .slice(0, MAX_REPORTED_SUSPECTS)
    .map((suspect) => `${suspect.label} ${Math.round(suspect.openMs)}ms`);
  const hidden = reading.suspects.length - named.length;
  const trail = [
    ...(named.length ? named : ['nothing was open long enough']),
    ...(hidden ? [`+${hidden} more`] : []),
    // The load around the block, kept as a count: forty short queries and one long import are the two
    // shapes this probe exists to tell apart.
    ...(reading.tooShort ? [`+${reading.tooShort} too short to have held it`] : []),
  ];
  const peak = Math.round(reading.peakMs);
  const window = Math.round(reading.windowMs);
  // Unprefixed: main puts `[hexly]` on its own lines, as it does for every other thing it logs.
  return `event-loop lag ${peak}ms peak in ${window}ms — ${trail.join(', ')}`;
}

/** What a request is called in a report: the route, not the resource — a query string is noise here. */
export function requestLabel(method: string | undefined, url: string | undefined): string {
  const path = url ? url.split('?')[0] : '?';
  const trimmed = path.length > MAX_LABEL_LENGTH ? `${path.slice(0, MAX_LABEL_LENGTH)}…` : path;
  return `${method ?? '?'} ${trimmed}`;
}

/** As much of an `http.Server` as watching what it is answering needs, so a spec can stand in for it. */
export interface RequestServer {
  on(
    event: 'request',
    listener: (
      req: { readonly method?: string; readonly url?: string },
      res: { on(event: 'close', listener: () => void): unknown },
    ) => void,
  ): unknown;
}

/**
 * Tell the probe what the API is serving. A listener on the server rather than Nest middleware: main is the
 * process that has the lag problem, so the instrument stays in main and the API learns nothing about it.
 *
 * `close` on the response, not `finish`: a request the renderer abandoned still occupied the loop, and
 * `close` is the one event every response emits.
 */
export function watchRequests(server: RequestServer, probe: LoopLagProbe): void {
  server.on('request', (req, res) => {
    const done = probe.during(requestLabel(req.method, req.url));
    res.on('close', done);
  });
}

/** How a maintainer turns the probe down, or off, without a rebuild. */
export function loopLagSettings(env: NodeJS.ProcessEnv): LoopLagSettings {
  const value = env[LOOP_LAG_ENV]?.trim().toLowerCase();
  if (value === 'off' || value === '0' || value === 'false') return { enabled: false };
  const threshold = Number(value);
  // A value we cannot read is not a reason to stop watching, nor to invent a threshold from it.
  const thresholdMs = value && Number.isFinite(threshold) && threshold > 0 ? threshold : DEFAULT_THRESHOLD_MS;
  return { enabled: true, thresholdMs };
}

/**
 * The probe over the real event loop. On by default because it can afford to be: `monitorEventLoopDelay` is
 * libuv's own timing, kept in C++, and the JS side only reads a peak once a second and drops the activities
 * the closing window is done with.
 *
 * When it is off nothing is created at all: no histogram, no interval, and `during` records nothing.
 *
 * One blind spot, and it is libuv's: the histogram's own timer only starts when the loop first runs, so work
 * done in the synchronous top-level pass before that is never measured. In main that pass is module
 * evaluation only — `boot` runs from `whenReady`, which is a loop callback, so the migrations are measured.
 */
export function startLoopLagProbe(settings: LoopLagSettings, report: (reading: LoopLagReading) => void): LoopLagProbe {
  if (!settings.enabled) return { during: () => noop, sample: noop };

  const histogram = monitorEventLoopDelay({ resolution: MONITOR_RESOLUTION_MS });
  histogram.enable();
  const probe = loopLagProbe({
    thresholdMs: settings.thresholdMs,
    report,
    peakDelayMs: () => {
      const peakMs = histogram.max / 1e6;
      histogram.reset();
      return Number.isFinite(peakMs) ? peakMs : 0;
    },
  });
  // `unref`, so a diagnostic can never be the reason this process is still running.
  setInterval(() => probe.sample(), SAMPLE_INTERVAL_MS).unref();
  return probe;
}

/** A probe that is off is called exactly as often as one that is on. */
function noop(): void {
  return undefined;
}
