import { Injectable, signal } from '@angular/core';
import { Observable, combineLatest, map, of, startWith, tap } from 'rxjs';
import { Command, CommandProvider } from './command';

/** One Provider's results for the current query, grouped under its own heading. */
export interface CommandSection {
  readonly provider: CommandProvider;
  readonly commands: readonly Command[];
}

/**
 * The root Command Registry (CONTEXT.md, ADR-0032): where Command Providers make
 * themselves known to the Command Palette. Built-in Providers register once at
 * bootstrap and live for the app's lifetime; a contextual Provider registers from
 * its owning component's constructor and calls the returned unregister function
 * on destroy — the same lifetime idiom as a route-scoped provider.
 */
@Injectable({ providedIn: 'root' })
export class CommandRegistry {
  private readonly providers = signal<readonly CommandProvider[]>([]);
  // Each Provider's most recent results, used to seed the next query so the list
  // never blanks between keystrokes (see search). Keyed by Provider identity;
  // bounded by the (small) Provider count, so no eviction needed.
  private readonly lastResults = new Map<CommandProvider, readonly Command[]>();

  register(provider: CommandProvider): () => void {
    this.providers.update((list) => [...list, provider]);
    return () => {
      this.providers.update((list) => list.filter((p) => p !== provider));
      this.lastResults.delete(provider);
    };
  }

  /**
   * Sections for every Provider bound to `prefix`, in registration order.
   * Providers resolve independently (server search vs. a static list), so this
   * merges their latest results via `combineLatest`; a slower Provider filling in
   * late never reorders the others (ADR-0032). Each stream is seeded with that
   * Provider's *previous* results rather than an empty list, so switching queries
   * shows the last-known rows until the new ones arrive (stale-while-revalidate)
   * instead of blanking and re-filling on every keystroke.
   */
  search(prefix: string, query: string): Observable<readonly CommandSection[]> {
    const matching = this.providers().filter((p) => p.prefix === prefix);
    if (!matching.length) return of([]);
    return combineLatest(
      matching.map((p) =>
        p.search(query).pipe(
          startWith<readonly Command[]>(this.lastResults.get(p) ?? []),
          tap((commands) => this.lastResults.set(p, commands)),
        ),
      ),
    ).pipe(
      map((results) =>
        matching.map((provider, i) => ({ provider, commands: results[i] })),
      ),
    );
  }
}
