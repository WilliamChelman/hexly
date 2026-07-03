import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const SIZE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 * 1024,
  gb: 1024 * 1024 * 1024,
};

/**
 * Parse a human-readable size (`"100mb"`, `"1.5gb"`, `"512 kb"`) into bytes.
 * Case-insensitive, whitespace-tolerant; a unit is required. Throws on anything
 * else so a typo'd limit in `hexly.yml` fails boot rather than silently meaning
 * "1 byte" (ADR-0036).
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
 * The literal, validated shape of `hexly.yml` (ADR-0036) — sizes are still
 * human-readable strings here. Unknown top-level keys are stripped, not rejected
 * (zod default), so a future reserved `featureFlags:` block won't crash an older
 * binary. `prefault` (not `default`) so an absent block is *parsed* as `{}` and
 * its field defaults fill in, rather than yielding a literal empty object.
 */
const rawConfigSchema = z.object({
  import: z
    .object({
      // Generous by default: an image-heavy vault balloons the *compressed* upload
      // (assets ride inside the .zip), so maxUpload is the ceiling that actually bites.
      // maxDecompressed meters all inflated bytes — markdown AND assets (ADR-0034) — so a
      // real vault stays well under it; it's a high zip-bomb backstop, not a tuning knob.
      maxUpload: sizeString('500mb'),
      maxDecompressed: sizeString('5gb'),
    })
    .prefault({}),
});

/** The validated-but-unprocessed config: what `hexly.yml` literally says (sizes as strings). */
export type HexlyConfigRaw = z.infer<typeof rawConfigSchema>;

/** The processed, app-facing Instance Configuration: sizes resolved to bytes, ready to consume. */
export interface HexlyConfig {
  import: {
    /** Max uploaded `.zip` size, in bytes. */
    maxUpload: number;
    /** Max decompressed vault size, in bytes (the zip-bomb guard). */
    maxDecompressed: number;
  };
}

/**
 * Preprocess the raw config into the shape the rest of the app consumes: sizes
 * become byte counts here (and any future derived values compute here), so no
 * consumer re-parses `"100mb"`. Sizes are already validated by the schema, so
 * `parseSize` cannot throw.
 */
function processConfig(raw: HexlyConfigRaw): HexlyConfig {
  return {
    import: {
      maxUpload: parseSize(raw.import.maxUpload),
      maxDecompressed: parseSize(raw.import.maxDecompressed),
    },
  };
}

/**
 * Load, validate, and preprocess the Instance Configuration from `hexly.yml` in
 * the Instance Directory (ADR-0036). A missing file, empty file, or `:memory:`
 * dir yields all defaults; a present file is merged over them. An invalid file
 * (bad YAML, wrong type, unparseable size) throws — a boot crash naming the bad
 * key beats a typo'd limit silently reverting to a default.
 */
export function loadConfig(instanceDir: string): HexlyConfig {
  const text = readConfigText(instanceDir);
  const raw = rawConfigSchema.parse((text === undefined ? undefined : parseYaml(text)) ?? {});
  return processConfig(raw);
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
