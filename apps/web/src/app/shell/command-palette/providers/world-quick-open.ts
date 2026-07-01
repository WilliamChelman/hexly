import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import { Command, CommandProvider } from '../command';
import { WorldStore } from '../../../core/services/world.store';

/**
 * Quick-open Provider for Worlds (ADR-0032): a client-side filter over the
 * already-loaded {@link WorldStore.worlds} — no server round trip. Picking a
 * World switches to it by URL, the same navigation as the World Switcher
 * (ADR-0028). Answers the empty prefix alongside {@link EntityQuickOpen}.
 */
@Injectable({ providedIn: 'root' })
export class WorldQuickOpen implements CommandProvider {
  private readonly store = inject(WorldStore);
  private readonly router = inject(Router);

  readonly prefix = '';
  readonly labelKey = 'commandPalette.world';

  search(query: string): Observable<Command[]> {
    const q = query.trim().toLowerCase();
    const worlds = this.store
      .worlds()
      .filter((w) => !q || w.name.toLowerCase().includes(q));
    return of(
      worlds.map((w) => ({
        id: w.id,
        title: w.name,
        run: () => this.router.navigate(['/w', w.id, 'entities']),
      })),
    );
  }
}
