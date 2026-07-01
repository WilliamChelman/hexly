import { Observable } from 'rxjs';

/**
 * A single invocable entry in the Command Palette (CONTEXT.md → Command): a
 * matched Entity or World to navigate to, or a static action such as creating a
 * Note. Invoking calls {@link run}; the Palette owns closing itself afterwards.
 */
export interface Command {
  readonly id: string;
  readonly title: string;
  run(): void;
}

/**
 * A source of Commands bound to a prefix (CONTEXT.md → Command Provider): the
 * empty prefix (Quick Open) or `>` (Show Commands). Each Provider owns its own
 * matching against the typed query. Several Providers may share a prefix; the
 * Palette lists each Provider's results in registration order and tags every row
 * inline with {@link labelKey} instead of grouping them under a heading.
 */
export interface CommandProvider {
  readonly prefix: string;
  /** Transloco key shown inline beside each of this Provider's Commands (e.g. "Entity", "World"). */
  readonly labelKey: string;
  search(query: string): Observable<Command[]>;
}
