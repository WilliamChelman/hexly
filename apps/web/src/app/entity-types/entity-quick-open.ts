import { DestroyRef, Injectable, effect, inject } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Observable, Subject, Subscription, filter, map, of, shareReplay, take } from 'rxjs';
import {
  EntitySummary,
  EntityType,
  FacetKeySet,
  RESERVED_FACET_NAMES,
  Visibility,
  parseFacetQuery,
} from '@hexly/domain';
import {
  ActiveWorld,
  EntitiesClient,
  EntityListParams,
  WorldsClient,
  searchEntities,
  entityRoute,
} from '@hexly/web-core';
import { Command, CommandProvider, CommandRegistry } from '@hexly/command-palette-web';
import { TypeRegistry } from './type-registry';

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
  private readonly types = inject(TypeRegistry);
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
  /** The box as of the last keystroke, so a query that waited on the registry knows it was superseded. */
  private asked = '';
  /** The registry's own signal that its Facet keys are settled (ADR-0082), as a stream to wait on. */
  private readonly fieldsResolved$ = toObservable(this.types.fieldsResolved);
  /**
   * What the box means as of the last keystroke (ADR-0082), read again in {@link scope} — after the
   * trailing debounce has chosen its keystroke, so the params belong to the query being sent.
   */
  private parsed = parseFacetQuery('', { reserved: [], fields: [] });
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

  /**
   * The Facet vocabulary the Palette offers on `$` and resolves a typed name against (ADR-0082), read
   * synchronously off the client registry — the active World's own Fields included, the Palette having
   * a World to be scoped to (ADR-0083). All four reserved names: `in` narrows within a scope that spans
   * the World *and* its Mounts, so naming one Container is meaningful here as it is not on a browse.
   */
  facetKeys(): FacetKeySet {
    return { reserved: RESERVED_FACET_NAMES, fields: this.types.facetKeys() };
  }

  /**
   * Whether the registry can answer for `key` yet (ADR-0082) — the same readiness {@link ask} waits on,
   * offered to the Palette's miss report so the two agree: a key this defers the search for is not one
   * the banner may call unknown meanwhile.
   */
  facetKeySettled(key: string): boolean {
    return this.types.facetKeySettled(key);
  }

  search(query: string): Observable<readonly Command[]> {
    const q = query.trim();
    // No World, no scope — and an unscoped read is the global search ADR-0083 removes, so it is never
    // made. Reachable only between `clearActiveWorld` unpinning and this Provider's own destruction.
    if (!q || !this.activeWorld.worldId()) return of([]);
    this.asked = q;
    this.ask(q);
    return this.commands$;
  }

  /**
   * Put the box to the search stream — once the registry can answer for every `$key` it names
   * (ADR-0082). Asked while the World's Fields are still in flight, a narrowing box would be answered
   * with the *unfiltered* list, and that list memoised under the very query meant to narrow it, so the
   * response would arrive too late to correct anything. A box naming no Field key never waits.
   */
  private ask(q: string): void {
    // A keystroke landed while this one waited: it is the search now, and this one is abandoned.
    if (q !== this.asked) return;
    const parsed = parseFacetQuery(q, this.facetKeys());
    const keys = [...parsed.fields.map((f) => f.key), ...parsed.unresolvedKeys];
    if (keys.every((key) => this.types.facetKeySettled(key))) {
      // The raw string keys the debounce and the memo — two boxes differing only in a token are two
      // different searches — while the params below are taken from its parse.
      this.parsed = parsed;
      this.query$.next(q);
      return;
    }
    this.fieldsResolved$
      .pipe(filter(Boolean), take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.ask(q));
  }

  /** The read's scope: the reader's World, plus the Containers it Mounts (ADR-0083), narrowed by
   * whatever the box's **Facet Tokens** name. */
  private scope(): EntityListParams {
    const worldId = this.activeWorld.worldId() ?? undefined;
    return {
      ...(worldId ? { worldId } : {}),
      ...(this.mountedContainerIds.length ? { containerId: this.mountedContainerIds } : {}),
      ...this.filters(),
    };
  }

  /**
   * The parsed box as wire params (ADR-0082). `q` is the **residual** free text — the tokens have become
   * params by here — so it replaces the raw string the search stream carries. A named Container rides
   * `container`, the drill-down *within* the scope, never `containerId`: a token narrows the Palette's
   * preset and can never widen it (ADR-0083).
   */
  private filters(): EntityListParams {
    const { include, exclude, fields } = this.parsed;
    return {
      q: this.parsed.text,
      ...(include.type.length ? { type: [...include.type] as EntityType[] } : {}),
      ...(include.tag.length ? { tag: [...include.tag] } : {}),
      ...(include.visibility.length ? { visibility: [...include.visibility] as Visibility[] } : {}),
      ...(include.container.length ? { container: [...include.container] } : {}),
      // The excluding half, which vetoes (ADR-0081).
      ...(exclude.type.length ? { excludeType: [...exclude.type] as EntityType[] } : {}),
      ...(exclude.tag.length ? { excludeTag: [...exclude.tag] } : {}),
      ...(exclude.visibility.length ? { excludeVisibility: [...exclude.visibility] as Visibility[] } : {}),
      ...(exclude.container.length ? { excludeContainer: [...exclude.container] } : {}),
      // A Field's exclusion rides the same param as its includes, through the op (ADR-0081).
      ...(fields.length ? { field: fields.map((f) => `${f.key}:${f.op}:${f.value}`) } : {}),
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
