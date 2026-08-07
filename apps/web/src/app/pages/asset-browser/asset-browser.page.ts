import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subscription, finalize } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { EntityFacets, EntitySummary, EntityType } from '@hexly/domain';
import { CORE_ASSET_TYPE_ID } from '@hexly/plugin-asset';
import {
  AppShellStore,
  AssetsClient,
  EntitiesClient,
  EntityFacetParams,
  ActiveWorld,
  ToasterService,
} from '@hexly/web-core';
import {
  ButtonComponent,
  DialogService,
  EyebrowComponent,
  FacetMissComponent,
  IconComponent,
  PageHeaderComponent,
} from '@hexly/web-ui';
import { DeleteEntityDialogComponent, DeleteEntityDialogData } from '../../entity-types/delete-entity-dialog.component';
import { EntitySearchComponent } from '../entity-browser/components/entity-search.component';
import { EmptyStateComponent } from '../entity-browser/components/empty-state.component';
import { FacetRailComponent } from '../entity-browser/components/facet-rail.component';
import { FACET_CATEGORIES, FacetTokenStore } from '../entity-browser/components/facet-token-store';

const NO_FACET_COUNTS: EntityFacets = { type: [], tag: [], visibility: [], fields: [] };

// A bounded first page, like the Entity Browser, so a media-heavy World loads fast.
const PAGE_SIZE = 50;

/**
 * The Asset Browser (`/w/:worldId/assets`, ADR-0065, #282): the Entity Browser **preset to the asset
 * type**, presenting the World's uploaded media as thumbnail tiles with upload at hand. It is not a bespoke
 * asset system — it drives the ordinary reader-scoped Entity list/facets pinned to `core.type.asset`, so a
 * private Asset shows only to its owner and a World Viewer sees only what is shared (both free from the
 * Entity model). Search (FTS `q`), the kind / orientation / hue dimensions and Tags are the same Facets the
 * Board image picker reuses; the type facet is pinned, so it is hidden from the rail. Upload mints (or
 * dedups to) an Asset through the ordinary path and refreshes page one.
 *
 * A tile whose Asset reports **Missing Bytes** (#325, ADR-0034) names that state instead of drawing a `src`
 * the server has already said it cannot serve.
 */
@Component({
  selector: 'app-asset-browser',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ButtonComponent,
    EyebrowComponent,
    IconComponent,
    PageHeaderComponent,
    TranslocoPipe,
    RouterLink,
    EntitySearchComponent,
    EmptyStateComponent,
    FacetMissComponent,
    FacetRailComponent,
  ],
  // No **Type**: it is pinned to the asset type here, so it never reaches the rail and `$type:` could
  // only widen past the pin. No **Container** either — one World. Both are stated misses (ADR-0082).
  providers: [{ provide: FACET_CATEGORIES, useValue: ['tag', 'visibility'] }],
  hostDirectives: [FacetTokenStore],
  host: { class: 'block min-h-full bg-surface-sunken' },
  template: `
    <app-page-header sticky>
      <div pageHeaderTitle class="flex flex-col">
        <span appEyebrow class="text-accent-strong! tracking-[0.28em]">{{ 'assetBrowser.eyebrow' | transloco }}</span>
        <h1 class="font-display text-[22px] text-ink-strong m-0 leading-tight">
          {{ 'assetBrowser.heading' | transloco }}
        </h1>
      </div>
      <!-- Upload at hand (ADR-0065): the button drives a hidden native file input so upload is the header's
           primary action, mirroring the Entity Browser's New button. -->
      <button
        pageHeaderActions
        type="button"
        appButton
        variant="primary"
        data-testid="asset-upload"
        [disabled]="uploading()"
        (click)="fileInput.click()"
      >
        <app-icon name="upload" [size]="16" />
        <span>{{ (uploading() ? 'assetBrowser.uploading' : 'assetBrowser.upload') | transloco }}</span>
      </button>
    </app-page-header>

    <main class="max-w-[72rem] mx-auto py-8 px-6">
      <!-- The button above drives this hidden native input (kept in the flow so its template ref resolves). -->
      <input
        #fileInput
        type="file"
        accept="image/*"
        class="sr-only"
        data-testid="asset-upload-input"
        [disabled]="uploading()"
        (change)="onFile($event)"
      />
      <!-- The whole vocabulary on the dollar (ADR-0082): keys off the registry, values off the Facet
           read this page already runs — the kind/orientation/hue dimensions among them. -->
      <app-entity-search
        [value]="filters.rawQuery()"
        [keys]="filters.facetKeys()"
        [facets]="facetCounts()"
        (queryChange)="filters.onSearch($event)"
      />
      <!-- What the Tokens applied nothing for is *said*, never quietly searched for (ADR-0082). -->
      <app-facet-miss class="-mt-6 mb-8 font-sans text-sm text-ink-faint" [parsed]="filters.parsedQuery()" />
      @if (uploadError()) {
        <p class="text-sm text-danger mb-4" data-testid="asset-upload-error">
          {{ 'assetBrowser.uploadError' | transloco }}
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
          @if (assets().length > 0) {
            <ul class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 m-0 p-0 list-none">
              @for (asset of assets(); track asset.id) {
                <li class="group relative">
                  <a
                    class="asset-tile"
                    [routerLink]="['/w', worldId(), 'entities', asset.id]"
                    [attr.data-testid]="'asset-tile-' + asset.id"
                    [attr.aria-label]="asset.name"
                    [title]="asset.name"
                  >
                    <!-- Missing Bytes take the tile ahead of the thumbnail (#325): the state came from the
                         server, so the request is known to 404. -->
                    @if (asset.assetBytesMissing) {
                      <span
                        class="flex h-full flex-col items-center justify-center gap-1 border border-dashed border-accent text-accent-strong"
                        [attr.data-testid]="'asset-missing-' + asset.id"
                      >
                        <app-icon name="asset-missing" [size]="28" />
                        <span class="px-1 text-center text-[0.65rem] leading-tight">{{
                          'assetBrowser.missing' | transloco
                        }}</span>
                      </span>
                    } @else if (asset.thumbnailUrl) {
                      <img
                        class="w-full h-full object-cover"
                        loading="lazy"
                        draggable="false"
                        [src]="asset.thumbnailUrl"
                        alt=""
                      />
                    } @else {
                      <span class="flex h-full items-center justify-center text-ink-faint">
                        <app-icon name="asset" [size]="32" />
                      </span>
                    }
                  </a>
                  <span
                    class="mt-1 block truncate font-sans text-xs text-ink-strong"
                    [attr.data-testid]="'asset-name-' + asset.id"
                    >{{ asset.name }}</span
                  >
                  @if (canDelete(asset)) {
                    <button
                      type="button"
                      appButton
                      icon
                      variant="ghost"
                      size="sm"
                      danger
                      class="absolute top-1 right-1 z-10 bg-surface/80 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                      [attr.data-testid]="'asset-delete-' + asset.id"
                      [attr.aria-label]="'common.delete' | transloco"
                      [attr.title]="'common.delete' | transloco"
                      (click)="remove(asset.id)"
                    >
                      <app-icon name="erase" [size]="16" />
                    </button>
                  }
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
                  {{ (loadingMore() ? 'assetBrowser.loadingMore' : 'assetBrowser.loadMore') | transloco }}
                </button>
              </div>
            }
          } @else if (loadError()) {
            <app-empty-state
              testid="load-error"
              [title]="'assetBrowser.loadErrorTitle' | transloco"
              [hint]="'assetBrowser.loadErrorHint' | transloco"
            />
          } @else if (loaded() && filters.hasFilters()) {
            <app-empty-state
              testid="no-matches"
              [title]="'assetBrowser.noMatchTitle' | transloco"
              [hint]="'assetBrowser.noMatchHint' | transloco"
            />
          } @else if (loaded()) {
            <app-empty-state
              testid="empty"
              [title]="'assetBrowser.emptyTitle' | transloco"
              [hint]="'assetBrowser.emptyHint' | transloco"
            />
          }
        </div>
      </div>
    </main>
  `,
  styles: `
    @reference '#app-styles.css';

    .asset-tile {
      @apply block aspect-square w-full overflow-hidden rounded-md border border-line bg-surface no-underline;
      @apply transition-shadow hover:shadow-3 focus-visible:[outline:2px_solid_var(--color-accent)] focus-visible:outline-offset-2 outline-none;
    }
  `,
})
export class AssetBrowserPage {
  private readonly entitiesClient = inject(EntitiesClient);
  private readonly assetsClient = inject(AssetsClient);
  private readonly activeWorld = inject(ActiveWorld);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);
  private readonly shell = inject(AppShellStore);
  private readonly dialogs = inject(DialogService);
  /** Both filter stores, `parse(text) ∪ railState` (ADR-0082) — the box, the rail, and their URL mirror. */
  protected readonly filters = inject(FacetTokenStore);

  protected readonly worldId = this.activeWorld.worldId;

  private readonly _assets = signal<EntitySummary[]>([]);
  /** Server order is authoritative (relevance under a query, updatedAt desc otherwise) — rendered verbatim. */
  protected readonly assets = this._assets.asReadonly();
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loadingMore = signal(false);
  protected readonly loaded = signal(false);
  protected readonly loadError = signal(false);
  protected readonly uploading = signal(false);
  protected readonly uploadError = signal(false);

  /** The rail counts with the type category stripped — the asset type is pinned, never a rail choice. */
  protected readonly facetCounts = signal<EntityFacets>(NO_FACET_COUNTS);
  private facetsSub?: Subscription;
  private fetchSub?: Subscription;
  private loadMoreSub?: Subscription;
  private shownWorldId?: string;

  constructor() {
    // The store seeds both filter stores from the URL in its own constructor, ahead of this effect, so
    // the first fetch already carries them (one request on load).
    effect(() => {
      this.filters.filterParams(); // tracked
      if (this.activeWorld.worldId()) this.fetchFirstPage();
    });
  }

  /** The delete verb gates the tile's delete action (ADR-0039); absent Rights hide it (fail-closed). */
  protected canDelete(asset: EntitySummary): boolean {
    return !!asset.rights?.includes('delete');
  }

  /** Fetch page one and replace the accumulated list — on load, after every filter change, and after upload/delete. */
  private fetchFirstPage(): void {
    const worldId = this.activeWorld.worldId();
    if (!worldId) return;
    this.fetchSub?.unsubscribe();
    this.loadMoreSub?.unsubscribe();
    this.loadingMore.set(false);
    const params = this.filters.filterParams();
    if (worldId !== this.shownWorldId) {
      this._assets.set([]);
      this.loaded.set(false);
    }
    this.shownWorldId = worldId;
    this.nextCursor.set(null);
    this.loadError.set(false);
    this.fetchSub = this.entitiesClient
      // Pinned to the asset type; thumbnails + rights opted in for the tiles and their delete gate (ADR-0065).
      .list({
        limit: PAGE_SIZE,
        worldId,
        type: [CORE_ASSET_TYPE_ID as EntityType],
        rights: true,
        thumbnails: true,
        ...params,
      })
      .pipe(this.shell.withLoading('subtle'))
      .subscribe({
        next: (page) => {
          this._assets.set(page.items);
          this.nextCursor.set(page.nextCursor);
          this.loaded.set(true);
        },
        error: () => {
          if (this._assets().length === 0) {
            this.loaded.set(true);
            this.loadError.set(true);
          }
        },
      });
    this.fetchFacetCounts(worldId, params);
  }

  /** Facet counts pinned to the asset type; the type category is stripped — it is pinned, never a rail choice. */
  private fetchFacetCounts(worldId: string, params: EntityFacetParams): void {
    this.facetsSub?.unsubscribe();
    this.facetsSub = this.entitiesClient
      .facets({ worldId, type: [CORE_ASSET_TYPE_ID as EntityType], ...params })
      .subscribe({
        next: (facets) => this.facetCounts.set({ ...facets, type: [] }),
        error: () => undefined,
      });
  }

  /** The `loadingMore` guard makes a double-click a no-op so a page can't append twice. */
  protected loadMore(): void {
    const cursor = this.nextCursor();
    if (cursor === null || this.loadingMore()) return;
    this.loadingMore.set(true);
    this.loadMoreSub = this.entitiesClient
      .list({
        cursor,
        worldId: this.activeWorld.worldId() ?? undefined,
        type: [CORE_ASSET_TYPE_ID as EntityType],
        rights: true,
        thumbnails: true,
        ...this.filters.filterParams(),
      })
      .pipe(finalize(() => this.loadingMore.set(false)))
      .subscribe({
        next: (page) => {
          this._assets.update((items) => [...items, ...page.items]);
          this.nextCursor.set(page.nextCursor);
        },
        error: () => this.toaster.show(this.transloco.translate('assetBrowser.loadMoreError'), 'error'),
      });
  }

  /** Upload the picked file — mints (or dedups to) an Asset — then refresh page one. */
  protected onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const worldId = this.activeWorld.worldId();
    if (!file || !worldId) return;
    this.uploadError.set(false);
    this.uploading.set(true);
    this.assetsClient
      .upload(worldId, file)
      .pipe(finalize(() => this.uploading.set(false)))
      .subscribe({
        next: () => {
          input.value = ''; // let the same file be re-picked after
          this.fetchFirstPage();
        },
        error: () => {
          input.value = '';
          this.uploadError.set(true);
        },
      });
  }

  /**
   * Confirm before deleting (ADR-0065): the generic, usage-aware dialog names the Entities that
   * reference this Asset (per-viewer) so the caller sees what a delete would dangle; confirm runs the
   * ordinary Entity delete (bytes + thumbnail follow), cancel does nothing.
   */
  protected remove(id: string): void {
    const name = this._assets().find((asset) => asset.id === id)?.name ?? '';
    this.dialogs
      .open<DeleteEntityDialogData, boolean>(DeleteEntityDialogComponent, { id, name })
      .closed.subscribe((confirmed) => {
        if (!confirmed) return;
        this.entitiesClient.delete(id).subscribe({
          next: () => this.fetchFirstPage(),
          error: () => this.toaster.show(this.transloco.translate('assetBrowser.deleteError'), 'error'),
        });
      });
  }
}
