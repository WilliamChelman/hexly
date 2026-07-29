import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, Subject, map, of, shareReplay } from 'rxjs';
import { EntitySummary } from '@hexly/domain';
import { EntitiesClient, searchEntities, entityRoute, idFromSegment } from '@hexly/web-core';
import { Command, CommandProvider } from '@hexly/command-palette-web';

/**
 * The empty-prefix Quick Open Provider (ADR-0032, CONTEXT.md → Command
 * Palette): matches Entities server-side (ADR-0025), globally — not scoped to
 * the active World. A search result carries its own `worldId`.
 */
@Injectable({ providedIn: 'root' })
export class EntityQuickOpen implements CommandProvider {
  private readonly entitiesClient = inject(EntitiesClient);
  private readonly router = inject(Router);

  readonly prefix = '';
  readonly label = 'commandPalette.entities';

  // Kept permanently hot (constructor subscription) so the debounce window
  // survives the palette re-subscribing per keystroke.
  // ponytail: no unsubscribe — app-lifetime root singleton, nothing to leak.
  private readonly query$ = new Subject<string>();
  // thumbnails=1 so a result row can show the Entity's resolved Thumbnail (ADR-0066) — recognizable
  // by sight before Enter. The emit contract (#286) carries thumbnailUrl on the summary.
  private readonly commands$ = searchEntities(this.entitiesClient, this.query$, { thumbnails: true }).pipe(
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
    // A **Sealed** entry has no World of its own (ADR-0079), so the segment is navigation context: the
    // World it is read from, and the one an **Adoption** would copy it into (#403). Read off the URL
    // rather than from `ActiveWorld`, whose injection would pull the World scope into a root singleton.
    // Picked from outside any World it still falls back to its Container and lands nowhere useful —
    // unchanged from before, and only fixable by giving a Compendium Entry a World-free page.
    const worldId = (entity.sealed && worldIdInUrl(this.router.url)) || entity.worldId;
    const route = entityRoute(worldId, entity.id);
    return {
      id: entity.id,
      label: entity.name,
      // The primary type (CONTEXT.md → Entity Type) as the quick-open hint.
      hint: entity.types[0],
      // The resolved Thumbnail (ADR-0066), present only when one resolved; absent → an unchanged row. Own
      // bytes reported as **Missing Bytes** (#325) count as unresolved: the URL is known to 404.
      thumbnailUrl: entity.assetBytesMissing ? undefined : entity.thumbnailUrl,
      route,
      run: () => void this.router.navigate(route),
    };
  }
}

/** The World the reader is currently in, off the URL — `null` anywhere outside the `/w/:worldId` scope. */
function worldIdInUrl(url: string): string | null {
  const segment = url.match(/^\/w\/([^/?#]+)/)?.[1];
  return segment ? idFromSegment(segment) : null;
}
