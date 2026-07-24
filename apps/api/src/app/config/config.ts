import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DeploymentProfile, PluginConfig, PluginConfigSchema } from '@hexly/domain';
import { parse as parseYaml } from 'yaml';
import * as z from 'zod';

/**
 * DI token for the loaded Instance Configuration (ADR-0036). Defined here, not in `config.module.ts`, so
 * a controller the module registers (the `GET /api/config` channel) can inject it without a cycle.
 */
export const HEXLY_CONFIG = Symbol('HEXLY_CONFIG');

/**
 * A bundled Plugin's contribution to config parsing (ADR-0052): its canonical id and its
 * `features.plugin.<id>` schema. The composition root folds the bundled set into this shape and hands
 * it to {@link loadConfig}, which merges the schemas — config.ts stays Plugin-aware without importing
 * the Plugins' heavier server halves.
 */
export interface PluginConfigContribution {
  readonly id: string;
  readonly configSchema: PluginConfigSchema;
}

/**
 * What a process **entry point** states about its deployment rather than what the operator configures
 * (ADR-0071). `profile` has no `hexly.yml` key at all — so nobody can declare `profile: desktop` on a
 * five-user server — and a pinned `collaboration` wins over `features.collaboration` in the file, which
 * is how the Desktop App makes that flag non-negotiable.
 */
export interface DeploymentPins {
  /** The Deployment Profile this entry point is; defaults to `server` when unstated. */
  readonly profile?: DeploymentProfile;
  /** Forces the Collaboration layer on/off, ignoring `features.collaboration`; unstated leaves the file in charge. */
  readonly collaboration?: boolean;
}

// Module state, not a provider: Nest composes the graph at import time, before the entry point speaks
// (ADR-0071). Unpinned is the conservative deployment, so `seed.ts` and every spec composing
// `ConfigModule` need not restate it.
let pinned: DeploymentPins = {};

/** State this process's deployment pins (ADR-0071); call from the entry point, before creating the Nest app. */
export function pinDeployment(pins: DeploymentPins): void {
  pinned = pins;
}

/** The pins this process's entry point stated — empty when it stated none. */
export function deploymentPins(): DeploymentPins {
  return pinned;
}

const SIZE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 * 1024,
  gb: 1024 * 1024 * 1024,
};

/**
 * Parse a human-readable size (`"100mb"`, `"1.5gb"`, `"512 kb"`) into bytes.
 * Case-insensitive, whitespace-tolerant; a unit is required. Throws on anything else.
 */
export function parseSize(input: string): number {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)\s*$/i.exec(input);
  if (!match) throw new Error(`Invalid size: ${JSON.stringify(input)}`);
  return Math.round(Number(match[1]) * SIZE_UNITS[match[2].toLowerCase()]);
}

/** A `hexly.yml` size field: a human-readable string, validated (not yet parsed) and defaulting when absent. */
function sizeString(defaultValue: string) {
  return z
    .string()
    .refine((s) => isValidSize(s), 'must be a size like "100mb" or "1.5gb"')
    .default(defaultValue);
}

function isValidSize(input: string): boolean {
  try {
    parseSize(input);
    return true;
  } catch {
    return false;
  }
}

/**
 * Compose the `features.plugin` schema from the bundled Plugins' own schemas (ADR-0052) — mirroring how
 * `enabledPluginTypes` composes from the bundled set. Each Plugin's block is `prefault`ed so an absent
 * one resolves to its field defaults (a Plugin the file never names is **enabled**), and the map itself
 * is `prefault`ed so an absent `features.plugin` yields every Plugin enabled. An unknown Plugin id is
 * stripped (no key in the shape) and an unknown sub-key is stripped by the Plugin's own object schema —
 * one strip-don't-crash rule across `hexly.yml`; only an invalid *value* (`enabled: "maybe"`) throws.
 */
function pluginFeaturesSchema(plugins: readonly PluginConfigContribution[]) {
  // Typed as a `PluginConfig`-valued shape so `z.infer` recovers `Record<string, PluginConfig>` for the
  // whole schema — keeping `HexlyConfigRaw` inferred, not hand-restated.
  const shape: Record<string, PluginConfigSchema> = {};
  for (const { id, configSchema } of plugins) shape[id] = configSchema.prefault({});
  return z.object(shape).prefault({});
}

/**
 * The literal, validated shape of `hexly.yml` (ADR-0036) — sizes are still human-readable strings here.
 * Unknown top-level keys are stripped, not rejected (zod default). `prefault` (not `default`) so an
 * absent block is *parsed* as `{}` and its field defaults fill in, rather than yielding a literal empty
 * object. Plugin-aware since ADR-0052: `features.plugin` is composed from the bundled `plugins`.
 */
function buildConfigSchema(plugins: readonly PluginConfigContribution[]) {
  return z.object({
    import: z
      .object({
        // maxDecompressed meters all inflated bytes — markdown AND assets (ADR-0034); it's a high
        // zip-bomb backstop, not a tuning knob.
        maxUpload: sizeString('500mb'),
        maxDecompressed: sizeString('5gb'),
        // false: batch-decompress, guarding on the zip's *declared* uncompressed size (a crafted
        // archive can spoof it). true: stream and meter *actual* output, aborting a zip bomb
        // mid-inflate at the cost of a slower import.
        strictZipGuard: z.boolean().default(false),
      })
      .prefault({}),
    // Full-text search relevance tuning (ADR-0035). bm25 multiplies each indexed column's
    // contribution by its weight, so a name hit outranks a body hit at the same frequency.
    search: z
      .object({
        weights: z
          .object({
            name: z.number().positive().default(10),
            tags: z.number().positive().default(5),
            content: z.number().positive().default(1),
          })
          .prefault({}),
      })
      .prefault({}),
    // Live-follow SSE heartbeat cadence (ADR-0044): how often the server pings each open stream to
    // keep it alive and surface a dead half-open socket for reaping.
    liveFollow: z
      .object({
        heartbeatSeconds: z.number().positive().default(30),
      })
      .prefault({}),
    features: z
      .object({
        // Per-Plugin enablement (ADR-0052): `features.plugin.<id>.enabled`, composed from the bundled set.
        plugin: pluginFeaturesSchema(plugins),
        // The Collaboration layer entire — sharing, World roles, Entity Visibility, Public Links
        // (ADR-0071). Defaults **on** so an existing Instance upgrades with no change; the Desktop App
        // turns it off through a {@link DeploymentPins} pin, never through this key.
        collaboration: z.boolean().default(true),
      })
      .prefault({}),
    // The Entity Type the "New" button mints by default (ADR-0052). Resolved verbatim, with no boot-time
    // validation against the enabled set — a soft client-side fallback handles absence, so this knob
    // never fails boot and stays independent of `features.plugin`.
    entities: z.object({ defaultType: z.string().default('core.type.note') }).prefault({}),
  });
}

/**
 * The validated-but-unprocessed config: what `hexly.yml` literally says (sizes as strings). Inferred
 * from the schema so it can't drift — `features.plugin` recovers as `Record<string, PluginConfig>`
 * because {@link pluginFeaturesSchema} types its shape with {@link PluginConfigSchema}.
 */
export type HexlyConfigRaw = z.infer<ReturnType<typeof buildConfigSchema>>;

/** The processed, app-facing Instance Configuration: sizes resolved to bytes, ready to consume. */
export interface HexlyConfig {
  /**
   * This Instance's Deployment Profile (ADR-0071). Not from `hexly.yml` — it comes from the entry
   * point's {@link DeploymentPins}, and a `profile:` key in the file is stripped like any unknown key.
   */
  profile: DeploymentProfile;
  import: {
    /** Max uploaded `.zip` size, in bytes. */
    maxUpload: number;
    /** Max decompressed vault size, in bytes (the zip-bomb guard). */
    maxDecompressed: number;
    /** Meter actual decompressed output (airtight, slower) vs. trust the zip's declared sizes (fast). */
    strictZipGuard: boolean;
  };
  search: {
    /** bm25 per-column multipliers (ADR-0035): higher = that column influences relevance more. */
    weights: { name: number; tags: number; content: number };
  };
  liveFollow: {
    /** SSE heartbeat cadence in seconds (ADR-0044, #177) — the keepalive/reap ping interval. */
    heartbeatSeconds: number;
  };
  features: {
    /**
     * Per-Plugin config keyed by canonical `PLUGIN_ID` (ADR-0052). Every bundled Plugin has an entry —
     * one absent from `hexly.yml` resolves **enabled** — carrying at least `enabled` plus any knobs the
     * Plugin's own schema adds. Nothing consumes it yet (#216); it is surfaced for later Seams.
     */
    plugin: Record<string, PluginConfig>;
    /**
     * Whether the Collaboration layer is on (ADR-0071): `features.collaboration`, defaulting **on**,
     * overridden by an entry-point pin. Nothing is gated on it yet (#314) — the flag is surfaced first.
     */
    collaboration: boolean;
  };
  entities: {
    /** The Entity Type the "New" button mints by default (ADR-0052); resolved verbatim, unvalidated. */
    defaultType: string;
  };
}

/** Sizes are already validated by the schema, so `parseSize` cannot throw here. */
function processConfig(raw: HexlyConfigRaw, pins: DeploymentPins): HexlyConfig {
  return {
    profile: pins.profile ?? 'server',
    import: {
      maxUpload: parseSize(raw.import.maxUpload),
      maxDecompressed: parseSize(raw.import.maxDecompressed),
      strictZipGuard: raw.import.strictZipGuard,
    },
    search: { weights: { ...raw.search.weights } },
    liveFollow: { heartbeatSeconds: raw.liveFollow.heartbeatSeconds },
    features: {
      plugin: raw.features.plugin,
      collaboration: pins.collaboration ?? raw.features.collaboration,
    },
    entities: { defaultType: raw.entities.defaultType },
  };
}

/**
 * Load, validate, and preprocess the Instance Configuration from `hexly.yml` in the Instance
 * Directory (ADR-0036). A missing file, empty file, or `:memory:` dir yields all defaults; a
 * present file is merged over them. An invalid file (bad YAML, wrong type, unparseable size) throws.
 *
 * `plugins` is the bundled Plugin set (ADR-0052) whose schemas compose `features.plugin`; the
 * composition root supplies it. Absent (as in tests that don't exercise Plugins), `features.plugin`
 * resolves empty.
 *
 * `pins` is what the entry point states rather than the operator (ADR-0071): it supplies the Deployment
 * Profile, which has no key in the file, and can override `features.collaboration`.
 */
export function loadConfig(
  instanceDir: string,
  plugins: readonly PluginConfigContribution[] = [],
  pins: DeploymentPins = {},
): HexlyConfig {
  const text = readConfigText(instanceDir);
  const raw = buildConfigSchema(plugins).parse((text === undefined ? undefined : parseYaml(text)) ?? {});
  return processConfig(raw, pins);
}

function readConfigText(instanceDir: string): string | undefined {
  if (instanceDir === ':memory:') return undefined;
  try {
    return readFileSync(join(instanceDir, 'hexly.yml'), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}
