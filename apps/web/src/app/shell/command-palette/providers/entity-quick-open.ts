import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, Subject, map, of, shareReplay } from 'rxjs';
import { EntitySummary } from '@hexly/domain';
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

  // The live query stream feeding the shared, debounced server search. Kept
  // permanently hot (constructor subscription) so the debounce window survives
  // the palette re-subscribing per keystroke.
  // ponytail: no unsubscribe — app-lifetime root singleton, nothing to leak.
  private readonly query$ = new Subject<string>();
  private readonly commands$ = searchEntities(
    this.entitiesClient,
    this.query$,
  ).pipe(
    map((items) => items.map((entity) => this.toCommand(entity))),
    // Replay the last results so a re-subscribing keystroke shows them until the
    // next search lands (stale-while-revalidate); refCount:false keeps the
    // debounce alive between keystrokes.
    shareReplay({ bufferSize: 1, refCount: false }),
  );

  constructor() {
    this.commands$.subscribe();
  }

  search(query: string): Observable<readonly Command[]> {
    const q = query.trim();
    if (!q) return of([]);
    this.query$.next(q);
    return this.commands$;
  }

  private toCommand(entity: EntitySummary): Command {
    const route = entityRoute(entity.worldId, entity.id);
    return {
      id: entity.id,
      label: entity.name,
      hint: entity.type,
      route,
      run: () => void this.router.navigate(route),
    };
  }
}
