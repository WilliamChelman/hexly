import { Observable } from 'rxjs';

/**
 * A single invocable entry in the Command Palette (CONTEXT.md → Command): a
 * matched Entity or World to jump to, or a static action like Create Note.
 * `run` performs it — a Provider decides what that means (navigate, open a
 * dialog, arm a Tool).
 */
export interface Command {
  readonly id: string;
  readonly label: string;
  /** Optional secondary text, e.g. an Entity's type. */
  readonly hint?: string;
  run(): void;
}

/**
 * A source of Commands bound to a prefix (CONTEXT.md → Command Provider). The
 * empty prefix is Quick Open; `>` is Show Commands. A Provider owns its own
 * matching against the typed query — no shared fuzzy-match engine (ADR-0032).
 */
export interface CommandProvider {
  readonly prefix: string;
  /** Section heading the Palette groups this Provider's results under. */
  readonly label: string;
  search(query: string): Observable<readonly Command[]>;
}

/** Splits palette input into the routing prefix and the rest of the query (ADR-0032). */
export function parseCommandQuery(text: string): {
  prefix: string;
  query: string;
} {
  if (text.startsWith('>')) return { prefix: '>', query: text.slice(1) };
  return { prefix: '', query: text };
}
