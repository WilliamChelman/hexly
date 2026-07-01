import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, map, of } from 'rxjs';
import { Command, CommandProvider } from '../command';
import { EntitiesClient } from '../../../core/services/entities.client';

/**
 * Quick-open Provider for Entities (ADR-0032): a server-side search over the
 * paginated `q` read surface (ADR-0025), global — not scoped to the active World,
 * so the Palette finds Entities anywhere. Picking one navigates to it via the
 * World-agnostic `/entities/:id` route, which redirects to its canonical World.
 * A blank query returns nothing rather than dumping every Entity (no MRU in v1).
 */
@Injectable({ providedIn: 'root' })
export class EntityQuickOpen implements CommandProvider {
  private readonly client = inject(EntitiesClient);
  private readonly router = inject(Router);

  readonly prefix = '';
  readonly labelKey = 'commandPalette.entity';

  search(query: string): Observable<Command[]> {
    const q = query.trim();
    if (!q) return of([]);
    return this.client.list({ q }).pipe(
      map((page) =>
        page.items.map((e) => ({
          id: e.id,
          title: e.name,
          run: () => this.router.navigate(['/entities', e.id]),
        })),
      ),
    );
  }
}
