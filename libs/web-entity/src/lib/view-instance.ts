/**
 * A **View instance** and its string key — the form "which View is showing" takes in the `?view=` param
 * and in a toggle's `data-testid` (ADR-0050).
 *
 * Must stay framework-free (hence kept apart from `view-definition.ts`): the Playwright suite imports
 * this codec by direct file path.
 */

/** A View id — see `view-definition.ts` for the keyspace. */
export type ViewId = string;

/**
 * One View an Entity affords. A View that renders a **Structured Data Type** is bound to the Field it
 * renders, so an Entity carrying two grids affords two map Views; a Type's own View (a plugin's stat
 * block, the Content view, the generic Field view) renders no particular Field and carries no key.
 */
export interface ViewInstance {
  readonly viewId: ViewId;
  /** The EntityDocument key of the **Field of a Structured Data Type** this View renders; absent on a Type's own View. */
  readonly fieldKey?: string;
}

/**
 * A View instance as one string: `core.view.content`, `core.view.map:grid`, `core.view.map:battlemap`.
 *
 * A `:` cannot occur in either half (a View id is `namespace.id`; a Field key is a EntityDocument key), so
 * the split is unambiguous. A Type's own View keys to its bare id.
 */
export function viewInstanceKey({ viewId, fieldKey }: ViewInstance): string {
  return fieldKey ? `${viewId}:${fieldKey}` : viewId;
}

/**
 * Read a View instance back out of its {@link viewInstanceKey} — a `?view=` param, so it may name
 * anything at all. This only parses; whether the Entity affords the result is `EntityViewStore`'s
 * business, and it falls back to the default View when it does not.
 */
export function parseViewInstanceKey(key: string | null | undefined): ViewInstance | null {
  if (!key) return null;
  const at = key.indexOf(':');
  if (at === -1) return { viewId: key };
  return { viewId: key.slice(0, at), fieldKey: key.slice(at + 1) };
}
