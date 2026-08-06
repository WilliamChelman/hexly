import { Observable } from 'rxjs';
import { FacetKeySet } from '@hexly/domain';

/**
 * A single invocable entry in the Command Palette. `run` performs it — a
 * Provider decides what that means (navigate, open a dialog, arm a Tool).
 */
export interface Command {
  readonly id: string;
  readonly label: string;
  /** Optional secondary text, e.g. an Entity's type. */
  readonly hint?: string;
  /** Optional preview tile shown beside the label (ADR-0066) — e.g. an Entity's resolved Thumbnail.
   * Always safe as an `<img src>`; a row without one renders unchanged. */
  readonly thumbnailUrl?: string;
  /** If the Command navigates, its routerLink commands array — the Palette
   * renders the row as an anchor so it can open in a new tab; `run()` stays
   * the plain in-place activation. */
  readonly route?: readonly string[];
  run(): void;
}

/**
 * A source of Commands bound to a prefix: empty is Quick Open, `>` is Show
 * Commands. A Provider owns its own matching against the typed query.
 */
export interface CommandProvider {
  readonly prefix: string;
  /** Section heading the Palette groups this Provider's results under. */
  readonly label: string;
  search(query: string): Observable<readonly Command[]>;
  /**
   * The **Facet Tokens** this Provider can apply (ADR-0082), off its own registry — omitted where it
   * filters by nothing. Read inside a computed, so a signal-backed vocabulary keeps the box current.
   */
  facetKeys?(): FacetKeySet;
}

/**
 * Route a query to the longest registered prefix it starts with, empty being
 * the always-present fallback, so no Provider hard-codes the set (ADR-0059).
 */
export function parseCommandQuery(
  text: string,
  prefixes: readonly string[],
): {
  prefix: string;
  query: string;
} {
  const match = prefixes.filter((p) => p !== '' && text.startsWith(p)).sort((a, b) => b.length - a.length)[0];
  if (match === undefined) return { prefix: '', query: text };
  return { prefix: match, query: text.slice(match.length) };
}
