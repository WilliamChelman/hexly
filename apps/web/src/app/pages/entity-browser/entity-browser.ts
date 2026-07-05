import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  Subject,
  Subscription,
  debounceTime,
  distinctUntilChanged,
  finalize,
  map,
} from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  EntityFacets,
  EntityPage,
  EntitySummary,
  EntityType,
  Visibility,
} from '@hexly/domain';
import {
  EntitiesClient,
  EntityFacetParams,
} from '../../core/services/entities.client';
import { ActiveWorld } from '../../core/services/active-world';
import { ToasterService } from '../../core/services/toaster.service';
import { AppShellStore } from '../../shell/app-shell.store';
import { Button } from '../../ui/button';
import { Eyebrow } from '../../ui/eyebrow';
import { PageHeader } from '../../ui/page-header';
import { Icon } from '../../ui/icon/icon';
import { EntityCard } from './entity-card';
import { EntitySearch } from './entity-search';
import { EmptyState } from './empty-state';
import { ActiveFacets, FacetRail, FacetToggle } from './facet-rail';

/** No selections in any Facet category — the reset/initial state (#155). */
const NO_FACETS: ActiveFacets = { type: [], tag: [], visibility: [] };

// ponytail: bounded first page so a large vault loads fast; bump or make
// configurable only if a real page size proves wrong in use.
const PAGE_SIZE = 50;

// Trailing-debounce window so fast typing fires one search, not one per key —
// same 150ms the shared searchEntities helper uses for autocomplete.
const SEARCH_DEBOUNCE_MS = 150;

// ponytail: cap the per-session first-page cache so a marathon session of distinct
// queries can't grow it without bound; oldest-out is plenty for backspace/retype.
const FIRST_PAGE_CACHE_LIMIT = 50;

/**
 * The Entity browser: the in-World surface (`/w/:worldId/entities`) where a user
 * sees every Entity in that World — notes and maps together — with name, type, tags,
 * and last-edited date, and runs the lifecycle: create (note or map), open,
 * rename in place, delete (#70, generalizing issue #6's map list). It accumulates
 * the entities as cursor-paginated pages (ADR-0025): a bounded first page on load,
 * a load-more control that appends the next page, and a refresh from page one after
 * every rename/delete so the view stays coherent without reconciling a stale tail.
 * Opening or creating navigates to `/w/:worldId/entities/:id`, the one type-dispatching route.
 */
@Component({
  selector: 'app-entity-browser',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Button,
    Eyebrow,
    PageHeader,
    Icon,
    TranslocoPipe,
    EntityCard,
    EntitySearch,
    EmptyState,
    FacetRail,
  ],
  host: { class: 'block min-h-full bg-surface-sunken' },
  template: `
    <app-page-header sticky>
      <div pageHeaderTitle class="flex flex-col">
        <span appEyebrow class="text-gold! tracking-[0.28em]">{{
          'entityBrowser.eyebrow' | transloco
        }}</span>
        <h1 class="font-display text-[22px] text-ink-strong m-0 leading-tight">
          {{ 'entityBrowser.heading' | transloco }}
        </h1>
      </div>
      <button
        type="button"
        pageHeaderActions
        appButton
        variant="default"
        data-testid="new-note"
        [disabled]="creating()"
        (click)="create('note')"
      >
        <app-icon name="plus" [size]="16" />
        {{
          (creating() ? 'entityBrowser.creating' : 'entityBrowser.newNote')
            | transloco
        }}
      </button>
      <button
        type="button"
        pageHeaderActions
        appButton
        variant="primary"
        data-testid="new-map"
        [disabled]="creating()"
        (click)="create('hexmap')"
      >
        <app-icon name="plus" [size]="16" />
        {{
          (creating() ? 'entityBrowser.creating' : 'entityBrowser.newMap')
            | transloco
        }}
      </button>
    </app-page-header>

    <main class="max-w-[72rem] mx-auto py-8 px-6">
      <app-entity-search [value]="query()" (queryChange)="onSearch($event)" />
      <div class="grid grid-cols-1 lg:grid-cols-[14rem_1fr] gap-8 items-start">
        <app-facet-rail
          [facetCounts]="facetCounts()"
          [active]="activeFacets()"
          [canClear]="hasFilters()"
          (toggled)="toggleFacet($event)"
          (clearAll)="clearAll()"
        />
        <div>
      @if (cards().length > 0) {
        <ul
          class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 m-0 p-0 list-none"
        >
          @for (card of cards(); track card.id) {
            <li>
              <app-entity-card
                [card]="card"
                [worldId]="worldId()"
                [renaming]="renamingId() === card.id"
                (startRename)="startRename(card.id)"
                (commitRename)="commitRename(card.id, $event)"
                (cancelRename)="cancelRename()"
                (remove)="remove(card.id)"
              />
            </li>
          }
        </ul>
        @if (nextCursor() !== null) {
          <div class="mt-8 flex justify-center">
            <button
              type="button"
              appButton
              variant="default"
              data-testid="load-more"
              [disabled]="loadingMore()"
              (click)="loadMore()"
            >
              {{
                (loadingMore()
                  ? 'entityBrowser.loadingMore'
                  : 'entityBrowser.loadMore'
                ) | transloco
              }}
            </button>
          </div>
        }
      } @else if (loadError()) {
        <app-empty-state
          testid="load-error"
          [title]="'entityBrowser.loadErrorTitle' | transloco"
          [hint]="'entityBrowser.loadErrorHint' | transloco"
        />
      } @else if (loaded() && query()) {
        <app-empty-state
          testid="no-matches"
          [title]="'entityBrowser.noMatchTitle' | transloco"
          [hint]="'entityBrowser.noMatchHint' | transloco"
        />
      } @else if (loaded()) {
        <app-empty-state
          testid="empty"
          [title]="'entityBrowser.emptyTitle' | transloco"
          [hint]="'entityBrowser.emptyHint' | transloco"
        />
      }
        </div>
      </div>
    </main>
  `,
})
export class EntityBrowser {
  private readonly entitiesClient = inject(EntitiesClient);
  private readonly activeWorld = inject(ActiveWorld);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);
  private readonly shell = inject(AppShellStore);

  /** The active World id (always present under `/w/:worldId`) — the routerLink scope for each tile. */
  protected readonly worldId = this.activeWorld.worldId;

  private readonly _entities = signal<EntitySummary[]>([]);
  /** The entities as view rows. The last-edited date stays a raw timestamp —
   * the card formats it via `| hexlyDate`, tracking language and Format Locale
   * live (ADR-0038). Server order is authoritative (#154): bm25 relevance under
   * a query, updatedAt desc otherwise — the list is rendered verbatim, never
   * re-sorted client-side. */
  protected readonly cards = computed(() =>
    this._entities().map((entity) => ({
      id: entity.id,
      title: entity.name,
      type: entity.type,
      tags: entity.tags,
      updatedAt: entity.updatedAt,
      // Opt-in Rights (ADR-0039), always requested here — the card gates rename/delete on them.
      rights: entity.rights,
    })),
  );
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loadingMore = signal(false);
  protected readonly loaded = signal(false);
  protected readonly loadError = signal(false);
  protected readonly creating = signal(false);
  protected readonly renamingId = signal<string | null>(null);

  /** The active full-text query, debounced from the search box (#154). Empty means
   * the default, last-edited view. Also the source of truth for the URL `q` mirror. */
  protected readonly query = signal('');
  /** Raw per-keystroke input, debounced before it becomes the committed `query`. */
  private readonly typed = new Subject<string>();

  /** The selected Facet values per category (#155), mirrored to/from the URL like `q`.
   * Value-equal so the URL round-trip's echo (a fresh object with the same values)
   * is a no-op instead of re-triggering the fetch effect — one refetch per toggle. */
  protected readonly activeFacets = signal<ActiveFacets>(NO_FACETS, {
    equal: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });
  /** The live Facet counts for the rail, recomputed server-side on every filter change. */
  protected readonly facetCounts = signal<EntityFacets>({
    type: [],
    tag: [],
    visibility: [],
  });
  /** Any active filter (query or a Facet) — gates the rail's Clear all control. */
  protected readonly hasFilters = computed(() => {
    const f = this.activeFacets();
    return (
      this.query() !== '' ||
      f.type.length > 0 ||
      f.tag.length > 0 ||
      f.visibility.length > 0
    );
  });

  /** The in-flight Facet-count read, cancelled on any refetch so a late one can't overwrite. */
  private facetsSub?: Subscription;

  private fetchSub?: Subscription;
  /** The in-flight load-more, cancelled on any first-page refetch so a late page
   * from a prior query/World can't append its rows or restore its stale cursor. */
  private loadMoreSub?: Subscription;
  /** The World the shown rows belong to, so a query change keeps them (stale-while-
   * revalidate, no flash) while a World change flushes them (never show another
   * World's rows). Undefined until the first fetch. */
  private shownWorldId?: string;

  /** First-page cache keyed by `worldId\0q`, so backspacing to a prior query paints
   * instantly (stale-while-revalidate). Per-World so switching Worlds can't paint
   * another World's rows. Bounded to shed the oldest entries in a long session. */
  private readonly firstPageCache = new Map<
    string,
    { items: EntitySummary[]; nextCursor: string | null }
  >();

  constructor() {
    // Read the URL `q` + Facets back into state: seeds them on a shared/refreshed
    // link and follows back/forward (#154, #155). Subscribed before the fetch effect
    // below, so the initial (synchronous) emission seeds state and the first fetch
    // already carries it — one request on load, not empty-then-refetch. Setting state
    // here never rewrites the URL (only the toggles/debounce below do), and the JSON
    // distinctUntilChanged absorbs the echo when a toggle's own navigate round-trips
    // back through here, so there's no read/write loop.
    this.route.queryParamMap
      .pipe(
        map((params) => ({
          q: params.get('q') ?? '',
          type: params.getAll('type'),
          tag: params.getAll('tag'),
          visibility: params.getAll('visibility'),
        })),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        takeUntilDestroyed(),
      )
      .subscribe((f) => {
        this.query.set(f.q);
        this.activeFacets.set({
          type: f.type,
          tag: f.tag,
          visibility: f.visibility,
        });
      });

    this.typed
      .pipe(debounceTime(SEARCH_DEBOUNCE_MS), takeUntilDestroyed())
      .subscribe((raw) => {
        const q = raw.trim();
        this.query.set(q); // fast typing fires one search, not one per key
        // Mirror to the URL so a filtered view is shareable and survives refresh —
        // the entity-header view-toggle pattern: merge (keep the World scope),
        // replaceUrl (don't push a history entry per keystroke), null to drop `?q=`.
        this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { q: q || null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      });

    // Re-fetch page one whenever the World (ADR-0028) or the query changes. The
    // browser only mounts under /w/:worldId, so a worldId is always present;
    // reacting to it covers a param-only switch between Worlds (same component).
    effect(() => {
      this.query(); // track: a new query refetches from page one under server order
      this.activeFacets(); // and any Facet change (#155) refetches + recomputes counts
      if (this.activeWorld.worldId()) this.fetchFirstPage();
    });
  }

  /** A keystroke in the search box — debounced into {@link query} before it fetches. */
  protected onSearch(value: string): void {
    this.typed.next(value);
  }

  /**
   * Toggle one Facet value on/off within its category (#155): OR within a category.
   * Clicking an active value removes it (that's the per-filter remove). The new
   * selection sets state (refetch + recount) and mirrors to the URL — merged so the
   * World scope and other params survive, replaceUrl so a click isn't a history entry.
   */
  protected toggleFacet({ category, value }: FacetToggle): void {
    const current = this.activeFacets();
    const values = current[category];
    const next = values.includes(value)
      ? values.filter((v) => v !== value)
      : [...values, value];
    const updated = { ...current, [category]: next };
    this.activeFacets.set(updated);
    this.mirrorToUrl({
      type: updated.type,
      tag: updated.tag,
      visibility: updated.visibility,
    });
  }

  /** Clear the query and every Facet at once (#155), dropping all filter params from the URL. */
  protected clearAll(): void {
    this.query.set('');
    this.activeFacets.set(NO_FACETS);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { q: null, type: null, tag: null, visibility: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** Mirror the active Facets to the URL; an empty category drops its param (`null`). */
  private mirrorToUrl(facets: ActiveFacets): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        type: facets.type.length ? [...facets.type] : null,
        tag: facets.tag.length ? [...facets.tag] : null,
        visibility: facets.visibility.length ? [...facets.visibility] : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /**
   * Fetch page one and replace the accumulated list with it (ADR-0025). Used on
   * load and after every create/rename/delete: refreshing from page one keeps the
   * view coherent without reconciling a stale accumulated tail, and page one is the
   * only view a client can always re-request — it needs no cursor and is bounded by
   * `limit`, so it survives any future opaque-cursor encoding change.
   */
  private fetchFirstPage(): void {
    const worldId = this.activeWorld.worldId();
    // Defensive: the browser only mounts under /w/:worldId, but never fetch the
    // whole owner list (every World) if the segment is somehow absent.
    if (!worldId) return;
    // Cancel any in-flight request from a previous World/query (prevents stale race).
    this.fetchSub?.unsubscribe();
    this.loadMoreSub?.unsubscribe(); // and any load-more, so its late page can't append
    this.loadingMore.set(false); // clear any stuck load-more from the previous page
    const params = this.activeFilterParams();
    const worldChanged = worldId !== this.shownWorldId;
    this.shownWorldId = worldId;
    // Key on World + the full filter state (query + Facets) so backspacing to any
    // prior combination paints from cache; JSON of the params is a stable key.
    const key = worldId + ' ' + JSON.stringify(params);
    const cached = this.firstPageCache.get(key);
    if (cached) {
      // Stale-while-revalidate: paint the previously-seen page instantly (backspace
      // to a prior query feels immediate), then refresh it from the server below.
      this._entities.set(cached.items);
      this.nextCursor.set(cached.nextCursor);
      this.loaded.set(true);
      this.loadError.set(false);
    } else if (worldChanged) {
      // A different World: flush to the loading state so no old-World rows linger.
      this._entities.set([]);
      this.nextCursor.set(null);
      this.loaded.set(false);
      this.loadError.set(false);
    } else {
      // Same World, uncached query: keep the current rows on screen through the fetch
      // so switching searches doesn't flash empty (the quick-search does the same).
      // Drop the load-more cursor — it belongs to the outgoing query; the incoming
      // page restores it.
      this.nextCursor.set(null);
      this.loadError.set(false);
    }
    this.fetchSub = this.entitiesClient
      .list({ limit: PAGE_SIZE, worldId, rights: true, ...params })
      .pipe(this.shell.withLoading('subtle'))
      .subscribe({
        next: (page) => {
          this.cacheFirstPage(key, page);
          this._entities.set(page.items);
          this.nextCursor.set(page.nextCursor);
          this.loaded.set(true);
        },
        // A failed fetch keeps whatever rows are already shown (stale-while-
        // revalidate); only a load with nothing to fall back to surfaces the error.
        error: () => {
          if (this._entities().length === 0) {
            this.loaded.set(true);
            this.loadError.set(true);
          }
        },
      });
    this.fetchFacetCounts(worldId, params);
  }

  /** The active query + Facets as list/facets params (#155); empty categories are omitted. */
  private activeFilterParams(): EntityFacetParams {
    const q = this.query();
    const f = this.activeFacets();
    return {
      ...(q ? { q } : {}),
      ...(f.type.length ? { type: [...f.type] as EntityType[] } : {}),
      ...(f.tag.length ? { tag: [...f.tag] } : {}),
      ...(f.visibility.length
        ? { visibility: [...f.visibility] as Visibility[] }
        : {}),
    };
  }

  /**
   * Recompute the Facet-rail counts alongside the paged list (#155), scoped to the
   * World and the active filters — the server drills each category down against the
   * others (ADR-0035). A failed read leaves the last-good counts on screen rather
   * than blanking the rail, matching the list's stale-while-revalidate posture.
   */
  private fetchFacetCounts(worldId: string, params: EntityFacetParams): void {
    this.facetsSub?.unsubscribe();
    this.facetsSub = this.entitiesClient.facets({ worldId, ...params }).subscribe({
      next: (facets) => this.facetCounts.set(facets),
      error: () => undefined,
    });
  }

  private cacheFirstPage(key: string, page: EntityPage): void {
    this.firstPageCache.set(key, {
      items: page.items,
      nextCursor: page.nextCursor,
    });
    if (this.firstPageCache.size > FIRST_PAGE_CACHE_LIMIT)
      this.firstPageCache.delete(
        this.firstPageCache.keys().next().value as string,
      );
  }

  /**
   * Fetch the next page via the opaque `nextCursor` and append it (ADR-0025). The
   * `loadingMore` guard makes a double-click a no-op so a page can't be appended
   * twice. A failed fetch just re-enables the control to retry — the list it already
   * shows stays intact.
   */
  protected loadMore(): void {
    const cursor = this.nextCursor();
    if (cursor === null || this.loadingMore()) return;
    this.loadingMore.set(true);
    // The cursor is an opaque offset; the server re-applies the filter from the
    // query + Facets, so paging a filtered set must re-send them all (#154, #155)
    // or it pages the unfiltered set from that offset.
    this.loadMoreSub = this.entitiesClient
      .list({
        cursor,
        worldId: this.activeWorld.worldId() ?? undefined,
        rights: true,
        ...this.activeFilterParams(),
      })
      .pipe(finalize(() => this.loadingMore.set(false)))
      .subscribe({
        next: (page) => {
          this._entities.update((entities) => [...entities, ...page.items]);
          this.nextCursor.set(page.nextCursor);
        },
        error: () =>
          this.toaster.show(
            this.transloco.translate('entityBrowser.loadMoreError'),
            'error',
          ),
      });
  }

  /** Create an empty Entity of `type` and open it straight away. */
  protected create(type: EntityType): void {
    if (this.creating()) return;
    this.creating.set(true);
    this.entitiesClient
      .create(
        this.transloco.translate(type === 'note' ? 'domain.untitledNote' : 'domain.untitledMap'),
        type,
        this.activeWorld.worldId() ?? undefined,
      )
      .pipe(finalize(() => this.creating.set(false)))
      .subscribe({
        // EntitySession loads on open; no pre-adopt from here (it would outlive this page).
        next: (entity) => this.open(entity.id),
        error: () =>
          this.toaster.show(
            this.transloco.translate('entityBrowser.createError'),
            'error',
          ),
      });
  }

  protected open(id: string): void {
    this.router.navigate(['/w', this.activeWorld.worldId(), 'entities', id]);
  }

  protected startRename(id: string): void {
    this.renamingId.set(id);
  }

  protected cancelRename(): void {
    this.renamingId.set(null);
  }

  /**
   * Rename by name only (ADR-0018). A blank, unchanged, or concurrently-deleted card
   * closes the input without a round trip. On error, closes and toasts.
   */
  protected commitRename(id: string, name: string): void {
    const trimmed = name.trim();
    const current = this._entities().find((entity) => entity.id === id);
    if (!trimmed || !current || trimmed === current.name) {
      this.cancelRename();
      return;
    }
    this.entitiesClient.patch(id, { name: trimmed }).subscribe({
      // Refresh from page one (ADR-0025) rather than reconcile in place: a rename
      // can move the item under the server's sort, so re-fetching keeps the view honest.
      next: () => {
        this.renamingId.set(null);
        this.invalidateCache();
        this.fetchFirstPage();
      },
      error: () => {
        this.cancelRename();
        this.toaster.show(
          this.transloco.translate('entityBrowser.renameError'),
          'error',
        );
      },
    });
  }

  /** Every cached first page is now stale (a rename/delete moved or removed a row);
   * drop them so the next fetch is a cold, fresh read rather than a stale paint. */
  private invalidateCache(): void {
    this.firstPageCache.clear();
  }

  /** Delete an entity, then refresh from page one once the server confirms (ADR-0025). */
  protected remove(id: string): void {
    this.entitiesClient.delete(id).subscribe({
      next: () => {
        this.invalidateCache();
        this.fetchFirstPage();
      },
      error: () =>
        this.toaster.show(
          this.transloco.translate('entityBrowser.deleteError'),
          'error',
        ),
    });
  }
}
