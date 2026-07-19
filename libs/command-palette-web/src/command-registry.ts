import { Injectable, computed, signal } from '@angular/core';
import { Observable, combineLatest, map, of, startWith, tap } from 'rxjs';
import { Command, CommandProvider } from './command';

export interface CommandSection {
  readonly provider: CommandProvider;
  readonly commands: readonly Command[];
}

/**
 * Root registry where Command Providers make themselves known to the Palette.
 * Built-ins register once for the app's lifetime; a contextual Provider calls
 * the returned unregister function on destroy.
 */
@Injectable({ providedIn: 'root' })
export class CommandRegistry {
  private readonly providers = signal<readonly CommandProvider[]>([]);
  // Each Provider's most recent results, seeding the next query so the list
  // never blanks between keystrokes. Bounded by the small Provider count.
  private readonly lastResults = new Map<CommandProvider, readonly Command[]>();

  /**
   * The distinct prefixes registered Providers answer, so the parser can route
   * to the longest match without hard-coding the set (ADR-0059).
   */
  readonly prefixes = computed<readonly string[]>(() => [...new Set(this.providers().map((p) => p.prefix))]);

  register(provider: CommandProvider): () => void {
    this.providers.update((list) => [...list, provider]);
    return () => {
      this.providers.update((list) => list.filter((p) => p !== provider));
      this.lastResults.delete(provider);
    };
  }

  /**
   * Sections for every Provider bound to `prefix`, in registration order — a
   * slower Provider filling in late never reorders the others.
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
    ).pipe(map((results) => matching.map((provider, i) => ({ provider, commands: results[i] }))));
  }
}
