import { DestroyRef, Injectable, effect, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Observable, Subject, Subscription, map, of, shareReplay } from 'rxjs';
import { EntitySummary } from '@hexly/domain';
import {
  ActiveWorld,
  EntitiesClient,
  EntityListParams,
  WorldsClient,
  searchEntities,
  entityRoute,
} from '@hexly/web-core';
import { Command, CommandProvider, CommandRegistry } from '@hexly/command-palette-web';

/**
 * The empty-prefix Quick Open Provider (ADR-0032, CONTEXT.md → Command Palette): matches Entities
 * server-side (ADR-0025), scoped to the World the reader is in and the **Containers** it **Mounts**
 * (ADR-0083). Not a root singleton — it lives for the `/w/:worldId` route's lifetime, which is both
 * what lets it inject {@link ActiveWorld} and why the Palette outside a World offers Worlds and
 * Commands and no Entities: the Provider does not exist there. The preset is not escapable.
 *
 * Scoped *like* a **link-target read** while staying a **navigation read** (CONTEXT.md →
 * Link-target read): same reach, arrived at from the other direction — this one neither gates Assets
 * nor ranks a Mount's Entities below the World's own.
 */
@Injectable()
export class EntityQuickOpen implements CommandProvider {
  private readonly entitiesClient = inject(EntitiesClient);
  private readonly worldsClient = inject(WorldsClient);
  private readonly activeWorld = inject(ActiveWorld);
  private readonly registry = inject(CommandRegistry);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly prefix = '';
  readonly label = 'commandPalette.entities';

  /**
   * The Containers the active World **Mounts**, so a **Compendium Entry** in a Mounted Compendium
   * stays findable by search (**Sealed**, ADR-0080). Empty until they load and where the read is
   * refused — a reader here through someone else's Mount is no member of this World, and the Palette
   * then searches the World alone rather than reporting a failure into an overlay.
   */
  private mountedContainerIds: string[] = [];
  private mountsSub?: Subscription;

  private readonly query$ = new Subject<string>();
  /**
   * Owned here rather than left inside the stream: it keys on the query alone, and a World switch is a
   * different set of answers under the same words (the route — and so this Provider — survives one).
   */
  private readonly searchCache = new Map<string, EntitySummary[]>();
  // Kept permanently hot (constructor subscription) so the debounce window
  // survives the palette re-subscribing per keystroke.
  // thumbnails=1 so a result row can show the Entity's resolved Thumbnail (ADR-0066) — recognizable
  // by sight before Enter. The emit contract (#286) carries thumbnailUrl on the summary.
  private readonly commands$ = searchEntities(this.entitiesClient, this.query$, {
    thumbnails: true,
    cache: this.searchCache,
    params: () => this.scope(),
  }).pipe(
    map((items) => items.map((entity) => this.toCommand(entity))),
    // Torn down with the World scope, ahead of the replay: unlike the root singleton this was, it has
    // a death, and a live search must not outlive the World it was scoped to.
    takeUntilDestroyed(this.destroyRef),
    // Replay the last results so a re-subscribing keystroke shows them until the
    // next search lands (stale-while-revalidate); refCount:false keeps the
    // debounce alive between keystrokes.
    shareReplay({ bufferSize: 1, refCount: false }),
  );

  constructor() {
    this.commands$.subscribe();
    // A contextual Provider registers itself and unregisters on destroy (ADR-0032) — leaving the World
    // scope is what takes Entities out of the Palette.
    this.destroyRef.onDestroy(this.registry.register(this));

    // The Mount set is a property of the active World, so it is re-read on a World switch — the route
    // is reused across one, so nothing else would refresh it. One tracked subscription, so a second
    // switch mid-flight cannot land the previous World's Mounts.
    effect(() => {
      const worldId = this.activeWorld.worldId();
      this.rescope([]);
      if (!worldId) return;
      this.mountsSub?.unsubscribe();
      this.mountsSub = this.worldsClient
        .mounts(worldId)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (mounts) => this.rescope(mounts.map((mount) => mount.containerId)),
          // Silent, refusal included: see {@link mountedContainerIds}.
          error: () => undefined,
        });
    });
  }

  search(query: string): Observable<readonly Command[]> {
    const q = query.trim();
    // No World, no scope — and an unscoped read is the global search ADR-0083 removes, so it is never
    // made. Reachable only between `clearActiveWorld` unpinning and this Provider's own destruction.
    if (!q || !this.activeWorld.worldId()) return of([]);
    this.query$.next(q);
    return this.commands$;
  }

  /** The read's scope: the reader's World, plus the Containers it Mounts (ADR-0083). */
  private scope(): EntityListParams {
    const worldId = this.activeWorld.worldId() ?? undefined;
    return {
      ...(worldId ? { worldId } : {}),
      ...(this.mountedContainerIds.length ? { containerId: this.mountedContainerIds } : {}),
    };
  }

  /** Take a new scope, dropping the results memoised under the old one. */
  private rescope(containerIds: string[]): void {
    this.mountedContainerIds = containerIds;
    this.searchCache.clear();
  }

  private toCommand(entity: EntitySummary): Command {
    // A **Sealed** entry has no World of its own (ADR-0079), so the segment is navigation context: the
    // World it is read from, and the one an **Adoption** would copy it into (#403) — the active World,
    // known directly now that this Provider is World-scoped (ADR-0083). An Entity of a Mounted *World*
    // has a World of its own and opens under it, as the World Graph's Foreign nodes do (ADR-0080).
    const worldId = (entity.sealed && this.activeWorld.worldId()) || entity.worldId;
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
