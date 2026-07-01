import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, map, of } from 'rxjs';
import { EntitiesClient } from '../../../core/services/entities.client';
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
    return this.entitiesClient.list({ q }).pipe(
      map((page) =>
        page.items.map(
          (entity): Command => ({
            id: entity.id,
            label: entity.name,
            hint: entity.type,
            run: () =>
              void this.router.navigate([
                '/w',
                entity.worldId,
                'entities',
                entity.id,
              ]),
          }),
        ),
      ),
    );
  }
}
