import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Subscription, finalize } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { EntityFacets, EntityPage, EntitySummary } from '@hexly/domain';
import { EntitiesClient, EntityFacetParams, ActiveWorld, ToasterService, AppShellStore } from '@hexly/web-core';
import { ButtonComponent, DialogService, EyebrowComponent, PageHeaderComponent } from '@hexly/web-ui';
import { NewEntityButtonComponent } from '../../entity-types/new-entity-button.component';
import { DeleteEntityDialogComponent, DeleteEntityDialogData } from '../../entity-types/delete-entity-dialog.component';
import { EntityCardComponent } from './components/entity-card.component';
import { EntitySearchComponent } from './components/entity-search.component';
import { EmptyStateComponent } from './components/empty-state.component';
import { FacetRailComponent } from './components/facet-rail.component';
import { FACET_CATEGORIES, FacetTokenStore } from './components/facet-token-store';

const NO_FACET_COUNTS: EntityFacets = {
  type: [],
  tag: [],
  visibility: [],
  fields: [],
};

// ponytail: bounded first page so a large vault loads fast; bump or make
// configurable only if a real page size proves wrong in use.
const PAGE_SIZE = 50;

// ponytail: cap the per-session first-page cache so a marathon session of distinct
// queries can't grow it without bound; oldest-out is plenty for backspace/retype.
const FIRST_PAGE_CACHE_LIMIT = 50;

/**
 * The Entity browser (`/w/:worldId/entities`): lists every Entity in the World
 * and runs the lifecycle — create, open, rename in place, delete. Accumulates
 * cursor-paginated pages and refreshes from page one after every mutation.
 */
@Component({
  selector: 'app-entity-browser',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ButtonComponent,
    EyebrowComponent,
    PageHeaderComponent,
    TranslocoPipe,
    EntityCardComponent,
    EntitySearchComponent,
    EmptyStateComponent,
    FacetRailComponent,
    NewEntityButtonComponent,
  ],
  // The universal trio, and no Container: this browse is scoped to one World — a Mounted one included
  // (ADR-0080) — so `$in:` has nothing to narrow and is reported as a miss (ADR-0082).
  providers: [{ provide: FACET_CATEGORIES, useValue: ['type', 'tag', 'visibility'] }],
  hostDirectives: [FacetTokenStore],
  host: { class: 'block min-h-full bg-surface-sunken' },
  template: `
    <app-page-header sticky>
      <div pageHeaderTitle class="flex flex-col">
        <span appEyebrow class="text-accent-strong! tracking-[0.28em]">{{ 'entityBrowser.eyebrow' | transloco }}</span>
        <h1 class="font-display text-[22px] text-ink-strong m-0 leading-tight">
          {{ 'entityBrowser.heading' | transloco }}
        </h1>
      </div>
      <app-new-entity-button pageHeaderActions />
    </app-page-header>

    <main class="max-w-[72rem] mx-auto py-8 px-6">
      <!-- The box offers the whole vocabulary on the dollar (ADR-0082): keys off the registry, values
           off the Facet read this page already runs. -->
      <app-entity-search
        [value]="filters.rawQuery()"
        [keys]="filters.facetKeys()"
        [facets]="facetCounts()"
        (queryChange)="filters.onSearch($event)"
      />
      <!-- A Facet Token naming a key nothing answers to is *said*, never quietly searched for (ADR-0082). -->
      @if (filters.unknownFacetKeys().length > 0) {
        <p data-testid="unknown-facet" role="status" class="-mt-6 mb-8 font-sans text-sm text-ink-faint">
          {{ 'entityBrowser.unknownFacet' | transloco: { keys: filters.unknownFacetKeys().join(', ') } }}
        </p>
      }
      <div class="grid grid-cols-1 lg:grid-cols-[14rem_1fr] gap-8 items-start">
        <app-facet-rail
          [facetCounts]="facetCounts()"
          [active]="filters.activeFacets()"
          [queryOwned]="filters.queryOwned()"
          [canClear]="filters.hasFilters()"
          [canExclude]="true"
          (toggled)="filters.toggleFacet($event)"
          (fieldValueToggled)="filters.toggleFieldValue($event)"
          (fieldRangeChanged)="filters.changeFieldRange($event)"
          (clearAll)="filters.clearAll()"
        />
        <div>
          @if (cards().length > 0) {
            <ul class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 m-0 p-0 list-none">
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
                  {{ (loadingMore() ? 'entityBrowser.loadingMore' : 'entityBrowser.loadMore') | transloco }}
                </button>
              </div>
            }
          } @else if (loadError()) {
            <app-empty-state
              testid="load-error"
              [title]="'entityBrowser.loadErrorTitle' | transloco"
              [hint]="'entityBrowser.loadErrorHint' | transloco"
            />
          } @else if (loaded() && filters.hasQuery()) {
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
export class EntityBrowserPage {
  private readonly entitiesClient = inject(EntitiesClient);
  private readonly activeWorld = inject(ActiveWorld);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);
  private readonly shell = inject(AppShellStore);
  private readonly dialogs = inject(DialogService);
  /** Both filter stores, `parse(text) ∪ railState` (ADR-0082) — the box, the rail, and their URL mirror. */
  protected readonly filters = inject(FacetTokenStore);

  protected readonly worldId = this.activeWorld.worldId;

  private readonly _entities = signal<EntitySummary[]>([]);
  /** Server order is authoritative (relevance under a query, updatedAt desc
   * otherwise) — rendered verbatim, never re-sorted client-side. */
  protected readonly cards = computed(() =>
    this._entities().map((entity) => ({
      id: entity.id,
      title: entity.name,
      // The card renders the primary type's icon and label (CONTEXT.md → Entity Type).
      type: entity.types[0],
      tags: entity.tags,
      updatedAt: entity.updatedAt,
      // The card gates rename/delete on rights.
      rights: entity.rights,
      // The resolved Thumbnail (ADR-0066), when the list opted in; absent → the card shows the type icon.
      thumbnailUrl: entity.thumbnailUrl,
      // Own bytes the server could not find (#325) — the card falls back to the sigil rather than a 404 image.
      assetBytesMissing: entity.assetBytesMissing,
    })),
  );
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loadingMore = signal(false);
  protected readonly loaded = signal(false);
  protected readonly loadError = signal(false);
  protected readonly renamingId = signal<string | null>(null);

  protected readonly facetCounts = signal<EntityFacets>(NO_FACET_COUNTS);

  /** In-flight Facet-count read, cancelled on refetch so a late one can't overwrite. */
  private facetsSub?: Subscription;

  private fetchSub?: Subscription;
  /** Cancelled on any first-page refetch so a late page from a prior query/World
   * can't append its rows or restore its stale cursor. */
  private loadMoreSub?: Subscription;
  /** The World the shown rows belong to: a query change keeps them (no flash),
   * a World change flushes them (never show another World's rows). */
  private shownWorldId?: string;

  /** First-page cache keyed by World + filters, so returning to a prior query
   * paints instantly (stale-while-revalidate). Bounded, oldest-out. */
  private readonly firstPageCache = new Map<string, { items: EntitySummary[]; nextCursor: string | null }>();

  constructor() {
    // Refetch page one whenever the World, query, or Facets change — covers a
    // param-only switch between Worlds (same component instance). The store seeds both
    // filter stores from the URL in its own constructor, ahead of this effect, so the
    // first fetch already carries them — one request on load.
    effect(() => {
      this.filters.filterParams(); // tracked
      if (this.activeWorld.worldId()) this.fetchFirstPage();
    });
  }

  /** Fetch page one and replace the accumulated list — on load and after every create/rename/delete. */
  private fetchFirstPage(): void {
    const worldId = this.activeWorld.worldId();
    // Never fetch the whole owner list (every World) if the segment is somehow absent.
    if (!worldId) return;
    // Cancel in-flight reads so a late page from a prior World/query can't land.
    this.fetchSub?.unsubscribe();
    this.loadMoreSub?.unsubscribe();
    this.loadingMore.set(false);
    const params = this.filters.filterParams();
    const worldChanged = worldId !== this.shownWorldId;
    this.shownWorldId = worldId;
    const key = worldId + ' ' + JSON.stringify(params);
    const cached = this.firstPageCache.get(key);
    if (cached) {
      // Stale-while-revalidate: paint the cached page instantly, refresh below.
      this._entities.set(cached.items);
      this.nextCursor.set(cached.nextCursor);
      this.loaded.set(true);
      this.loadError.set(false);
    } else if (worldChanged) {
      // Different World: flush so no old-World rows linger.
      this._entities.set([]);
      this.nextCursor.set(null);
      this.loaded.set(false);
      this.loadError.set(false);
    } else {
      // Same World, uncached filters: keep the current rows through the fetch (no
      // empty flash), but drop the cursor — it belongs to the outgoing query.
      this.nextCursor.set(null);
      this.loadError.set(false);
    }
    this.fetchSub = this.entitiesClient
      // thumbnails opted in so each card shows its Thumbnail, recognizable by sight (ADR-0066).
      .list({ limit: PAGE_SIZE, worldId, rights: true, thumbnails: true, ...params })
      .pipe(this.shell.withLoading('subtle'))
      .subscribe({
        next: (page) => {
          this.cacheFirstPage(key, page);
          this._entities.set(page.items);
          this.nextCursor.set(page.nextCursor);
          this.loaded.set(true);
        },
        // Keep shown rows on failure; only surface the error with nothing to fall back to.
        error: () => {
          if (this._entities().length === 0) {
            this.loaded.set(true);
            this.loadError.set(true);
          }
        },
      });
    this.fetchFacetCounts(worldId, params);
  }

  /** A failed read leaves the last-good counts on screen rather than blanking the rail. */
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
      this.firstPageCache.delete(this.firstPageCache.keys().next().value as string);
  }

  /** The `loadingMore` guard makes a double-click a no-op so a page can't append twice. */
  protected loadMore(): void {
    const cursor = this.nextCursor();
    if (cursor === null || this.loadingMore()) return;
    this.loadingMore.set(true);
    // The cursor is an opaque offset; paging a filtered set must re-send all
    // filters or it pages the unfiltered set from that offset.
    this.loadMoreSub = this.entitiesClient
      .list({
        cursor,
        worldId: this.activeWorld.worldId() ?? undefined,
        rights: true,
        thumbnails: true,
        ...this.filters.filterParams(),
      })
      .pipe(finalize(() => this.loadingMore.set(false)))
      .subscribe({
        next: (page) => {
          this._entities.update((entities) => [...entities, ...page.items]);
          this.nextCursor.set(page.nextCursor);
        },
        error: () => this.toaster.show(this.transloco.translate('entityBrowser.loadMoreError'), 'error'),
      });
  }

  protected startRename(id: string): void {
    this.renamingId.set(id);
  }

  protected cancelRename(): void {
    this.renamingId.set(null);
  }

  /** A blank, unchanged, or concurrently-deleted card closes the input without a round trip. */
  protected commitRename(id: string, name: string): void {
    const trimmed = name.trim();
    const current = this._entities().find((entity) => entity.id === id);
    if (!trimmed || !current || trimmed === current.name) {
      this.cancelRename();
      return;
    }
    this.entitiesClient.patch(id, { name: trimmed }).subscribe({
      // A rename can move the item under the server's sort; refetch, don't reconcile.
      next: () => {
        this.renamingId.set(null);
        this.invalidateCache();
        this.fetchFirstPage();
      },
      error: () => {
        this.cancelRename();
        this.toaster.show(this.transloco.translate('entityBrowser.renameError'), 'error');
      },
    });
  }

  private invalidateCache(): void {
    this.firstPageCache.clear();
  }

  /**
   * Confirm before deleting (ADR-0065): the generic, usage-aware dialog names the Entities that link
   * here (per-viewer) so the caller sees what a delete would dangle; confirm runs the ordinary delete,
   * cancel does nothing.
   */
  protected remove(id: string): void {
    const name = this._entities().find((entity) => entity.id === id)?.name ?? '';
    this.dialogs
      .open<DeleteEntityDialogData, boolean>(DeleteEntityDialogComponent, { id, name })
      .closed.subscribe((confirmed) => {
        if (!confirmed) return;
        this.entitiesClient.delete(id).subscribe({
          next: () => {
            this.invalidateCache();
            this.fetchFirstPage();
          },
          error: () => this.toaster.show(this.transloco.translate('entityBrowser.deleteError'), 'error'),
        });
      });
  }
}
