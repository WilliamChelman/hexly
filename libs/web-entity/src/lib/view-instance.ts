/**
 * A **View instance** and its string key — the wire format of "which View is showing" (ADR-0050, #200).
 *
 * Framework-free on purpose, and kept apart from `view-definition.ts` (which names Angular's
 * `InjectionToken` and a component `Type`): the key is the form the choice takes in the `?view=` param
 * and in a toggle's `data-testid`, so the Playwright suite reaches this codec by direct file path —
 * the same waiver `pretty-id` has — rather than re-spelling the format in a fixture and letting the
 * two drift.
 */

/** A View id — see `view-definition.ts` for the keyspace. */
export type ViewId = string;

/**
 * One View an Entity affords — a View **instance**, not a bare id.
 *
 * A View id alone was the whole identity of a View while an Entity could afford each one *once*. That
 * breaks on the case the Structured Field merge exists to unlock: an Entity carrying both
 * `core.hexmap` and a `world.deity` that declares its own grid has **two** grids, so it affords two
 * map Views — one per Field. So a View that renders a Structured Field is bound to {@link fieldKey},
 * the Field it renders; a Type-contributed View (a plugin's stat block, the Content view, the generic
 * Field view) renders no particular Field and carries none.
 */
export interface ViewInstance {
  readonly viewId: ViewId;
  /** The Metadata key of the **Structured Field** this View renders; absent on a Type's own View. */
  readonly fieldKey?: string;
}

/**
 * A View instance as one string — the form it takes in the `?view=` param and in a toggle's testid:
 * `core.view.content`, `core.view.map:grid`, `core.view.map:battlemap`. A `:` cannot occur in either
 * half (a View id is `namespace.id`; a Field key is a Metadata key), so the split is unambiguous and
 * a Type-contributed View's key is still just its id — which is what keeps an existing shared link
 * (`?view=core.view.content`) working.
 */
export function viewInstanceKey({ viewId, fieldKey }: ViewInstance): string {
  return fieldKey ? `${viewId}:${fieldKey}` : viewId;
}

/**
 * Read a View instance back out of its {@link viewInstanceKey} — a `?view=` param, which is user input
 * and so may name anything at all. This only *parses*; whether the Entity actually affords the result
 * is the `EntityViewStore`'s business, which falls back to the default View when it does not.
 */
export function parseViewInstanceKey(key: string | null | undefined): ViewInstance | null {
  if (!key) return null;
  const at = key.indexOf(':');
  if (at === -1) return { viewId: key };
  return { viewId: key.slice(0, at), fieldKey: key.slice(at + 1) };
}
