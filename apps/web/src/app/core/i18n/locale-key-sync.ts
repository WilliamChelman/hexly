/**
 * The shape of a drift report between two language catalogs.
 *
 * Keys are compared, not values: a translation differs by design, but the *set*
 * of keys must match so French can never silently miss (or orphan) a string.
 */
export interface KeyDrift {
  /** Dot-path keys present in the reference (en) catalog but absent from fr. */
  missingInFr: string[];
  /** Dot-path keys present in fr but absent from the reference (en) catalog. */
  missingInEn: string[];
  /** True when neither catalog has a key the other lacks. */
  inSync: boolean;
}

/**
 * Compare two translation catalogs by their key sets and report any drift.
 *
 * The first argument is the source-of-truth catalog (English, per ADR-0014);
 * the second is the catalog being checked against it. The comparison is
 * symmetric, so an orphaned French key is caught just as a missing one is.
 */
export function findKeyDrift(
  en: Record<string, unknown>,
  fr: Record<string, unknown>,
): KeyDrift {
  const enKeys = new Set(flattenKeys(en));
  const frKeys = new Set(flattenKeys(fr));

  const missingInFr = [...enKeys].filter((key) => !frKeys.has(key));
  const missingInEn = [...frKeys].filter((key) => !enKeys.has(key));

  return {
    missingInFr,
    missingInEn,
    inSync: missingInFr.length === 0 && missingInEn.length === 0,
  };
}

/**
 * Flatten a nested translation catalog into its set of leaf dot-paths
 * (e.g. `{ auth: { heading: '…' } }` → `['auth.heading']`).
 */
export function flattenKeys(
  catalog: Record<string, unknown>,
  prefix = '',
): string[] {
  return Object.entries(catalog).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return isCatalog(value) ? flattenKeys(value, path) : [path];
  });
}

function isCatalog(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
