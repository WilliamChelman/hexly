import { Observable } from 'rxjs';

/**
 * A single invocable entry in the Command Palette. `run` performs it — a
 * Provider decides what that means (navigate, open a dialog, arm a Tool).
 */
export interface Command {
  readonly id: string;
  readonly label: string;
  /** Optional secondary text, e.g. an Entity's type. */
  readonly hint?: string;
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
}

export function parseCommandQuery(text: string): {
  prefix: string;
  query: string;
} {
  if (text.startsWith('>')) return { prefix: '>', query: text.slice(1) };
  return { prefix: '', query: text };
}
