/**
 * The shape of a drift report between two language catalogs.
 *
 * Keys are compared, not values: a translation differs by design, but the *set*
 * of keys must match so a non-reference catalog can never silently miss (or
 * orphan) a string. Array values are treated as opaque leaves — this gate
 * guards the key *set*, not value types or array contents.
 */
export interface KeyDrift {
  /** Dot-path keys in the reference catalog that the target catalog lacks. */
  missing: string[];
  /** Dot-path keys in the target catalog that have no reference counterpart. */
  orphaned: string[];
  /** True when neither catalog has a key the other lacks. */
  inSync: boolean;
}

/**
 * Compare two translation catalogs by their key sets and report any drift.
 *
 * `reference` is the source-of-truth catalog (English, per ADR-0014); `target`
 * is the catalog being checked against it. A key present in `reference` but not
 * `target` is reported as `missing`; a key present only in `target` is reported
 * as `orphaned`.
 */
export function findKeyDrift(
  reference: Record<string, unknown>,
  target: Record<string, unknown>,
): KeyDrift {
  const referencePaths = flattenPaths(reference);
  const targetPaths = flattenPaths(target);
  const referenceKeys = new Set(referencePaths.map(serialize));
  const targetKeys = new Set(targetPaths.map(serialize));

  const missing = referencePaths
    .filter((path) => !targetKeys.has(serialize(path)))
    .map(toDotPath);
  const orphaned = targetPaths
    .filter((path) => !referenceKeys.has(serialize(path)))
    .map(toDotPath);

  return {
    missing,
    orphaned,
    inSync: missing.length === 0 && orphaned.length === 0,
  };
}

/**
 * Flatten a nested catalog into its leaf dot-paths
 * (`{ auth: { heading: '…' } }` → `['auth.heading']`). An empty object is itself
 * a leaf (`{ settings: {} }` → `['settings']`), so a stubbed namespace present
 * in one catalog but absent from another is still caught as drift.
 */
export function flattenKeys(catalog: Record<string, unknown>): string[] {
  return flattenPaths(catalog).map(toDotPath);
}

/**
 * Flatten to path *segments* rather than a pre-joined string, so a key that
 * itself contains a `.` (e.g. `{ 'a.b': 1 }`) can never alias a nested path
 * (`{ a: { b: 1 } }`) when key sets are compared.
 */
function flattenPaths(
  catalog: Record<string, unknown>,
  prefix: readonly string[] = [],
): string[][] {
  return Object.entries(catalog).flatMap(([key, value]) => {
    const path = [...prefix, key];
    if (!isCatalog(value)) return [path];
    const nested = flattenPaths(value, path);
    // An empty object yields no nested leaves; treat the namespace itself as a
    // leaf so an empty-vs-absent namespace still registers as drift.
    return nested.length ? nested : [path];
  });
}

/** Unambiguous comparison key for a path: distinguishes `['a.b']` from `['a','b']`. */
const serialize = (path: readonly string[]): string => JSON.stringify(path);

/** Human-readable dot-path for reporting. */
const toDotPath = (path: readonly string[]): string => path.join('.');

function isCatalog(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
