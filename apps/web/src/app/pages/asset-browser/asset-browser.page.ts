import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, Subscription, debounceTime, distinctUntilChanged, finalize, map } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { EntityFacets, EntityPage, EntitySummary, EntityType, parseFieldFilters, Visibility } from '@hexly/domain';
import { CORE_ASSET_TYPE_ID } from '@hexly/plugin-asset';
import {
  AppShellStore,
  AssetsClient,
  EntitiesClient,
  EntityFacetParams,
  ActiveWorld,
  ToasterService,
} from '@hexly/web-core';
import { ButtonComponent, DialogService, EyebrowComponent, IconComponent, PageHeaderComponent } from '@hexly/web-ui';
import { DeleteEntityDialogComponent, DeleteEntityDialogData } from '../../entity-types/delete-entity-dialog.component';
import { EntitySearchComponent } from '../entity-browser/components/entity-search.component';
import { EmptyStateComponent } from '../entity-browser/components/empty-state.component';
import {
  ActiveFacets,
  FacetRailComponent,
  FacetToggle,
  FieldRangeChange,
  FieldSelection,
  FieldValueToggle,
  isFieldSelectionEmpty,
} from '../entity-browser/components/facet-rail.component';

/** Serialize the active Field selections to the `key:op:value` tokens the API + URL speak. */
function fieldTokens(fields: Readonly<Record<string, FieldSelection>>): string[] {
  const tokens: string[] = [];
  for (const [key, sel] of Object.entries(fields)) {
    for (const v of sel.values ?? []) tokens.push(`${key}:eq:${v}`);
    if (sel.gte) tokens.push(`${key}:gte:${sel.gte}`);
    if (sel.lte) tokens.push(`${key}:lte:${sel.lte}`);
  }
  return tokens;
}

/** Fold the repeated `field` params back into the per-key {@link FieldSelection} record. */
function fieldsFromTokens(tokens: readonly string[]): Record<string, FieldSelection> {
  const out: Record<string, { values: string[]; gte?: string; lte?: string }> = {};
  for (const f of parseFieldFilters(tokens)) {
    const sel = (out[f.key] ??= { values: [] });
    if (f.op === 'eq') sel.values.push(f.value);
    else if (f.op === 'gte') sel.gte = f.value;
    else sel.lte = f.value;
  }
  return out;
}

/** Drop a Field key once its selection is empty, so `hasFilters`/the URL never carry a dead entry. */
function pruneField(sel: FieldSelection): FieldSelection | undefined {
  return isFieldSelectionEmpty(sel) ? undefined : sel;
}

const NO_FACETS: ActiveFacets = { type: [], tag: [], visibility: [], fields: {} };
const NO_FACET_COUNTS: EntityFacets = { type: [], tag: [], visibility: [], fields: [] };

// A bounded first page, like the Entity Browser, so a media-heavy World loads fast.
const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 150;

/**
 * The Asset Browser (`/w/:worldId/assets`, ADR-0065, #282): the Entity Browser **preset to the asset
 * type**, presenting the World's uploaded media as thumbnail tiles with upload at hand. It is not a bespoke
 * asset system — it drives the ordinary reader-scoped Entity list/facets pinned to `core.type.asset`, so a
 * private Asset shows only to its owner and a World Viewer sees only what is shared (both free from the
 * Entity model). Search (FTS `q`), the kind / orientation / hue dimensions and Tags are the same Facets the
 * Board image picker reuses; the type facet is pinned, so it is hidden from the rail. Upload mints (or
 * dedups to) an Asset through the ordinary path and refreshes page one.
 *
 * A tile whose Asset reports **Missing Bytes** (#325) says so rather than drawing a blank frame: the grid is
 * where a user notices a whole shelf of stranded art at once, which is exactly when "your files are
 * elsewhere" must not read as "your World is corrupt".
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
    FacetRailComponent,
  ],
  host: { class: 'block min-h-full bg-surface-sunken' },
  template: `
    <app-page-header sticky>
      <div pageHeaderTitle class="flex flex-col">
        <span appEyebrow class="text-gold! tracking-[0.28em]">{{ 'assetBrowser.eyebrow' | transloco }}</span>
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
      <app-entity-search [value]="query()" (queryChange)="onSearch($event)" />
      @if (uploadError()) {
        <p class="text-sm text-ember mb-4" data-testid="asset-upload-error">
          {{ 'assetBrowser.uploadError' | transloco }}
        </p>
      }
      <div class="grid grid-cols-1 lg:grid-cols-[14rem_1fr] gap-8 items-start">
        <app-facet-rail
          [facetCounts]="facetCounts()"
          [active]="activeFacets()"
          [canClear]="hasFilters()"
          (toggled)="toggleFacet($event)"
          (fieldValueToggled)="toggleFieldValue($event)"
          (fieldRangeChanged)="changeFieldRange($event)"
          (clearAll)="clearAll()"
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
                    <!-- Missing bytes are their own tile, ahead of the thumbnail (#325): the server says the
                         file is not under the resolved Assets root, so the grid names that instead of drawing
                         a blank frame the user would read as data loss. No src in this state — we know it
                         404s. The dashed frame carries the state at a glance; the label names it. -->
                    @if (asset.assetBytesMissing) {
                      <span
                        class="flex h-full flex-col items-center justify-center gap-1 border border-dashed border-gold text-gold"
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
          } @else if (loaded() && hasFilters()) {
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
      @apply transition-shadow hover:shadow-3 focus-visible:[outline:2px_solid_var(--color-gold)] focus-visible:outline-offset-2 outline-none;
    }
  `,
})
export class AssetBrowserPage {
  private readonly entitiesClient = inject(EntitiesClient);
  private readonly assetsClient = inject(AssetsClient);
  private readonly activeWorld = inject(ActiveWorld);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);
  private readonly shell = inject(AppShellStore);
  private readonly dialogs = inject(DialogService);

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

  /** Debounced full-text query; empty means the default last-edited view. Mirrored to the URL `q`. */
  protected readonly query = signal('');
  private readonly typed = new Subject<string>();

  /** Value-equal so the URL round-trip's echo doesn't re-trigger the fetch effect. The type facet is
   * pinned to the asset type here, so it is never carried in `type`. */
  protected readonly activeFacets = signal<ActiveFacets>(NO_FACETS, {
    equal: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });
  /** The rail counts with the type category stripped — the asset type is pinned, never a rail choice. */
  protected readonly facetCounts = signal<EntityFacets>(NO_FACET_COUNTS);
  protected readonly hasFilters = computed(() => {
    const f = this.activeFacets();
    return this.query() !== '' || f.tag.length > 0 || f.visibility.length > 0 || Object.keys(f.fields).length > 0;
  });

  private facetsSub?: Subscription;
  private fetchSub?: Subscription;
  private loadMoreSub?: Subscription;
  private shownWorldId?: string;

  constructor() {
    // Seed query + Facets from the URL and follow back/forward, before the fetch effect so the first
    // emission lands before the first fetch (one request on load).
    this.route.queryParamMap
      .pipe(
        map((params) => ({
          q: params.get('q') ?? '',
          tag: params.getAll('tag'),
          visibility: params.getAll('visibility'),
          field: params.getAll('field'),
        })),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        takeUntilDestroyed(),
      )
      .subscribe((f) => {
        this.query.set(f.q);
        this.activeFacets.set({ type: [], tag: f.tag, visibility: f.visibility, fields: fieldsFromTokens(f.field) });
      });

    this.typed.pipe(debounceTime(SEARCH_DEBOUNCE_MS), takeUntilDestroyed()).subscribe((raw) => {
      const q = raw.trim();
      this.query.set(q);
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { q: q || null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    });

    effect(() => {
      this.query(); // tracked
      this.activeFacets(); // tracked
      if (this.activeWorld.worldId()) this.fetchFirstPage();
    });
  }

  protected onSearch(value: string): void {
    this.typed.next(value);
  }

  /** The delete verb gates the tile's delete action (ADR-0039); absent Rights hide it (fail-closed). */
  protected canDelete(asset: EntitySummary): boolean {
    return !!asset.rights?.includes('delete');
  }

  protected toggleFacet({ category, value }: FacetToggle): void {
    const current = this.activeFacets();
    const values = current[category];
    const next = values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
    this.applyFacets({ ...current, [category]: next });
  }

  protected toggleFieldValue({ key, value }: FieldValueToggle): void {
    const current = this.activeFacets();
    const sel = current.fields[key] ?? {};
    const values = sel.values ?? [];
    const nextValues = values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
    this.setFieldSelection(current, key, { ...sel, values: nextValues });
  }

  protected changeFieldRange({ key, bound, value }: FieldRangeChange): void {
    const current = this.activeFacets();
    const sel = current.fields[key] ?? {};
    this.setFieldSelection(current, key, { ...sel, [bound]: value || undefined });
  }

  private setFieldSelection(current: ActiveFacets, key: string, sel: FieldSelection): void {
    const fields = { ...current.fields };
    const pruned = pruneField(sel);
    if (pruned) fields[key] = pruned;
    else delete fields[key];
    this.applyFacets({ ...current, fields });
  }

  private applyFacets(updated: ActiveFacets): void {
    this.activeFacets.set(updated);
    this.mirrorToUrl(updated);
  }

  protected clearAll(): void {
    this.query.set('');
    this.activeFacets.set(NO_FACETS);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { q: null, tag: null, visibility: null, field: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private mirrorToUrl(facets: ActiveFacets): void {
    const field = fieldTokens(facets.fields);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        tag: facets.tag.length ? [...facets.tag] : null,
        visibility: facets.visibility.length ? [...facets.visibility] : null,
        field: field.length ? field : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** Fetch page one and replace the accumulated list — on load, after every filter change, and after upload/delete. */
  private fetchFirstPage(): void {
    const worldId = this.activeWorld.worldId();
    if (!worldId) return;
    this.fetchSub?.unsubscribe();
    this.loadMoreSub?.unsubscribe();
    this.loadingMore.set(false);
    const params = this.activeFilterParams();
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

  private activeFilterParams(): EntityFacetParams {
    const q = this.query();
    const f = this.activeFacets();
    const field = fieldTokens(f.fields);
    return {
      ...(q ? { q } : {}),
      ...(f.tag.length ? { tag: [...f.tag] } : {}),
      ...(f.visibility.length ? { visibility: [...f.visibility] as Visibility[] } : {}),
      ...(field.length ? { field } : {}),
    };
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
        ...this.activeFilterParams(),
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
