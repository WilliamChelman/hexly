import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, map, of } from 'rxjs';
import { EntitiesClient } from '../../../core/services/entities.client';
import { searchEntities } from '../../../core/utils/search-entities';
import { entityRoute } from '../../../core/utils/routes';
import { Command, CommandProvider } from '../command';

/**
 * The empty-prefix Quick Open Provider (ADR-0032, CONTEXT.md → Command
 * Palette): matches Entities server-side (ADR-0025), globally — not scoped to
 * the active World, unlike the entity browser. Picking one navigates straight
 * to it since a search result already carries its own `worldId`.
 */
@Injectable({ providedIn: 'root' })
export class EntityQuickOpen implements CommandProvider {
  private readonly entitiesClient = inject(EntitiesClient);
  private readonly router = inject(Router);

  readonly prefix = '';
  readonly label = 'commandPalette.entities';

  search(query: string): Observable<readonly Command[]> {
    const q = query.trim();
    if (!q) return of([]);
    // Shared server search (trims, caps the page, swallows errors to []) so a
    // failed search yields no matches rather than erroring the merged stream —
    // which would otherwise leave the palette unable to search until reopened.
    return searchEntities(this.entitiesClient, q).pipe(
      map((items) =>
        items.map((entity): Command => {
          const route = entityRoute(entity.worldId, entity.id);
          return {
            id: entity.id,
            label: entity.name,
            hint: entity.type,
            route,
            run: () => void this.router.navigate(route),
          };
        }),
      ),
    );
  }
}
