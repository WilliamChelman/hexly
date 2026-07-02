import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import { WorldStore } from '../../../core/services/world.store';
import { worldRoute } from '../../../core/utils/routes';
import { Command, CommandProvider } from '../command';

/**
 * The empty-prefix Quick Open Provider for Worlds (ADR-0032): a client-side
 * filter over {@link WorldStore}'s already-loaded list — no fetch of its own.
 * Picking one switches World the same way the World Switcher does.
 */
@Injectable({ providedIn: 'root' })
export class WorldQuickOpen implements CommandProvider {
  private readonly worldStore = inject(WorldStore);
  private readonly router = inject(Router);

  readonly prefix = '';
  readonly label = 'commandPalette.worlds';

  search(query: string): Observable<readonly Command[]> {
    const q = query.trim().toLowerCase();
    const worlds = this.worldStore
      .worlds()
      .filter((w) => !q || w.name.toLowerCase().includes(q));
    return of(
      worlds.map(
        (world): Command => {
          const route = worldRoute(world.id);
          return {
            id: world.id,
            label: world.name,
            route,
            run: () => void this.router.navigate(route),
          };
        },
      ),
    );
  }
}
