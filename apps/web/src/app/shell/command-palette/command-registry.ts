import { Injectable, signal } from '@angular/core';
import { Observable, combineLatest, map, of, startWith } from 'rxjs';
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

  register(provider: CommandProvider): () => void {
    this.providers.update((list) => [...list, provider]);
    return () =>
      this.providers.update((list) => list.filter((p) => p !== provider));
  }

  /**
   * Sections for every Provider bound to `prefix`, in registration order.
   * Providers resolve independently (server search vs. a static list), so this
   * merges their latest results via `combineLatest` rather than waiting for all
   * of them — a slower Provider filling in late never reorders the others
   * (ADR-0032).
   */
  search(prefix: string, query: string): Observable<readonly CommandSection[]> {
    const matching = this.providers().filter((p) => p.prefix === prefix);
    if (!matching.length) return of([]);
    return combineLatest(
      matching.map((p) => p.search(query).pipe(startWith<readonly Command[]>([]))),
    ).pipe(
      map((results) =>
        matching.map((provider, i) => ({ provider, commands: results[i] })),
      ),
    );
  }
}
