import { monitorEventLoopDelay } from 'node:perf_hooks';

/**
 * Main's loop serves every HTTP response as well as the windows, so this is the tripwire ADR-0070 left itself
 * for the `utilityProcess` decision (#329) — the ADR carries the reasoning and the measured baseline. Lag is
 * attributed to a window rather than an instant, and narrowed by arithmetic: the loop is held in one unbroken
 * stretch, so anything open for less than the peak cannot have spanned it.
 */

/** Read off `process.env`: `off` to silence it, or a number of milliseconds to report above. */
export const LOOP_LAG_ENV = 'HEXLY_LOOP_LAG';

/** Where the menu bar starts to feel it (ADR-0070). */
export const DEFAULT_THRESHOLD_MS = 100;

/**
 * Coarse on purpose: libuv does the timing at {@link MONITOR_RESOLUTION_MS}, so a slower sample loses no block
 * — it only widens the window a block is attributed to.
 */
export const SAMPLE_INTERVAL_MS = 1000;

/** How often libuv times itself: fine enough for a 100 ms block, coarse enough to cost nothing. */
export const MONITOR_RESOLUTION_MS = 20;

/**
 * How much of the peak an activity may be short by and still be a suspect, on top of
 * {@link MONITOR_RESOLUTION_MS}: both figures compared are wall-clock, so a tolerance of only the sampling
 * period exonerates the true culprit about as often as not (ADR-0070).
 */
export const SUSPECT_SLACK = 0.1;

export const MAX_REPORTED_SUSPECTS = 4;

/** An Entity id makes a path long, and nothing reads the tail of it. */
export const MAX_LABEL_LENGTH = 120;

export type LoopLagSettings = { readonly enabled: false } | { readonly enabled: true; readonly thresholdMs: number };

/** See {@link SUSPECT_SLACK}. */
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
  /** Carries its own {@link MONITOR_RESOLUTION_MS} sampling period, so the true block is up to that shorter. */
  readonly peakMs: number;
  /** A sample interval, plus however late the lag made this sample. */
  readonly windowMs: number;
  /** Tightest fit first. Empty means the block came from work main never labelled. */
  readonly suspects: readonly LoopLagSuspect[];
  /** How much else the window held, all of it too short to have caused the block. */
  readonly tooShort: number;
}

export interface LoopLagProbe {
  /**
   * Mark `label` as occupying main until the returned function is called. Overlap and nesting are expected, and
   * a second call to the same ender is the same end.
   */
  during(label: string): () => void;
  /** Close the current window: read the worst delay in it and report it if it crossed the threshold. */
  sample(): void;
}

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
  /** {@link suspectSlackMs} by default, and `() => 0` for a spec doing exact arithmetic. */
  slackMs?(peakMs: number): number;
  /** A `Date.now` seam, so a spec drives the clock instead of waiting on it. */
  now?: () => number;
}

/**
 * The probe's decisions with the event loop it watches held at arm's length; {@link startLoopLagProbe} owns the
 * real histogram and timer. What it holds is bounded by the sample interval: one entry per activity in flight,
 * plus one per activity that finished since the last sample.
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
          // Clipped to the window at both ends: this window can only hold an activity responsible for what it
          // did inside it.
          const openMs = (occupation.endedAt ?? at) - Math.max(occupation.startedAt, windowOpenedAt);
          if (openMs + slack >= peakMs) suspects.push({ label: occupation.label, openMs });
          else tooShort++;
        }
        // Ascending: the smallest activity that was open long enough is the tightest explanation.
        suspects.sort((one, other) => one.openMs - other.openMs);
        options.report({ peakMs, windowMs: at - windowOpenedAt, suspects, tooShort });
      }
      // Whatever finished belongs to the window just closed; the next one can only be held by what is open.
      occupations = occupations.filter((occupation) => occupation.endedAt === undefined);
      windowOpenedAt = at;
    },
  };
}

/** One line, since a report is read in a terminal beside every other line main writes. */
export function describeLoopLag(reading: LoopLagReading): string {
  const named = reading.suspects
    .slice(0, MAX_REPORTED_SUSPECTS)
    .map((suspect) => `${suspect.label} ${Math.round(suspect.openMs)}ms`);
  const hidden = reading.suspects.length - named.length;
  const trail = [
    ...(named.length ? named : ['nothing was open long enough']),
    ...(hidden ? [`+${hidden} more`] : []),
    // Kept as a count: forty short queries and one long import are the two shapes this exists to tell apart.
    ...(reading.tooShort ? [`+${reading.tooShort} too short to have held it`] : []),
  ];
  const peak = Math.round(reading.peakMs);
  const window = Math.round(reading.windowMs);
  // Unprefixed: main adds `[hexly]`, as it does for everything else it logs.
  return `event-loop lag ${peak}ms peak in ${window}ms — ${trail.join(', ')}`;
}

/** The route, not the resource: a query string is noise in a report. */
export function requestLabel(method: string | undefined, url: string | undefined): string {
  const path = url ? url.split('?')[0] : '?';
  const trimmed = path.length > MAX_LABEL_LENGTH ? `${path.slice(0, MAX_LABEL_LENGTH)}…` : path;
  return `${method ?? '?'} ${trimmed}`;
}

/** As much of an `http.Server` as watching it needs, so a spec can stand in for one. */
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
 * A listener on the server rather than Nest middleware: main is the process with the lag problem, so the API
 * learns nothing about it. `close`, not `finish`: a request the renderer abandoned still occupied the loop.
 */
export function watchRequests(server: RequestServer, probe: LoopLagProbe): void {
  server.on('request', (req, res) => {
    const done = probe.during(requestLabel(req.method, req.url));
    res.on('close', done);
  });
}

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
 * libuv's own timing, kept in C++, and the JS side only reads a peak once a second. One blind spot, libuv's: the
 * histogram starts when the loop first runs, so module evaluation is not measured — `boot` runs from
 * `whenReady`, so the migrations are.
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

function noop(): void {
  return undefined;
}
