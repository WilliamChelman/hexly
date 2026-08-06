import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, Subscription, debounceTime, distinctUntilChanged, finalize, map } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  EntityFacets,
  EntityPage,
  EntitySummary,
  EntityType,
  FacetKeySet,
  FacetTokenTarget,
  FieldFilter,
  parseFacetQuery,
  removeFacetToken,
  Visibility,
} from '@hexly/domain';
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
  FacetCategory,
  FacetRailComponent,
  FacetToggle,
  FieldRangeChange,
  FieldSelection,
  FieldValueToggle,
  togglePolarity,
} from '../entity-browser/components/facet-rail.component';
import { fieldTokens, fieldsFromTokens, pruneField } from '../entity-browser/components/field-facet-url';
import { queryOwnedFacets, unionFacets } from '../entity-browser/components/facet-token-union';
import { TypeRegistry } from '../../entity-types/type-registry';

const NO_FACETS: ActiveFacets = {
  type: [],
  tag: [],
  visibility: [],
  fields: {},
  container: [],
  // The excluding half (ADR-0081). No `type` for the same reason its positive twin is never filled: the
  // asset type is pinned here, so the category never reaches the rail; no `container` — one World.
  excluded: { tag: [], visibility: [] },
};
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
    FacetRailComponent,
  ],
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
        [value]="rawQuery()"
        [keys]="facetKeys()"
        [facets]="facetCounts()"
        (queryChange)="onSearch($event)"
      />
      <!-- A Facet Token naming a key nothing answers to is *said*, never quietly searched for (ADR-0082). -->
      @if (unknownFacetKeys().length > 0) {
        <p data-testid="unknown-facet" role="status" class="-mt-6 mb-8 font-sans text-sm text-ink-faint">
          {{ 'entityBrowser.unknownFacet' | transloco: { keys: unknownFacetKeys().join(', ') } }}
        </p>
      }
      @if (uploadError()) {
        <p class="text-sm text-danger mb-4" data-testid="asset-upload-error">
          {{ 'assetBrowser.uploadError' | transloco }}
        </p>
      }
      <div class="grid grid-cols-1 lg:grid-cols-[14rem_1fr] gap-8 items-start">
        <app-facet-rail
          [facetCounts]="facetCounts()"
          [active]="activeFacets()"
          [queryOwned]="queryOwned()"
          [canClear]="hasFilters()"
          [canExclude]="true"
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
      @apply transition-shadow hover:shadow-3 focus-visible:[outline:2px_solid_var(--color-accent)] focus-visible:outline-offset-2 outline-none;
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
  /** The client registry a Facet Token's key resolves against, synchronously (ADR-0082). */
  private readonly types = inject(TypeRegistry);

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

  /**
   * The **text store** (ADR-0082): the box exactly as it was typed, debounced and never rewritten here.
   * Source of truth for the URL `q` mirror, which carries this *raw* string; the wire carries
   * {@link searchText}, the residual after every token is lifted out.
   */
  protected readonly rawQuery = signal('');
  private readonly typed = new Subject<string>();

  /**
   * This surface's Facet vocabulary, from the client registry, synchronously — minus `type`, which is
   * pinned to the asset type here and so has nothing to narrow, and minus `in`: one World, one
   * Container. Both are reported as a miss rather than dropped silently (ADR-0082). One set, read
   * thrice: the parser resolves against it, the box offers it on `$`, and a rail click finds the token
   * it deletes by it.
   */
  protected readonly facetKeys = computed<FacetKeySet>(() => ({
    reserved: ['tag', 'visibility'],
    fields: this.types.facetKeys(),
  }));
  /** What the box means: its **Facet Tokens** as structured filters and the free text left over. */
  protected readonly parsedQuery = computed(() => parseFacetQuery(this.rawQuery(), this.facetKeys()));
  /** Which rail rows the text owns, so they render as query-owned and click off as a token (ADR-0082). */
  protected readonly queryOwned = computed(() => queryOwnedFacets(this.parsedQuery()));
  /** The residual full-text query — what the wire's `q` carries, as against the URL's raw string. */
  private readonly searchText = computed(() => this.parsedQuery().text);
  /** Whether the box holds anything at all to search or filter by — blanks are not a query. */
  private readonly hasQuery = computed(() => this.rawQuery().trim() !== '');
  /** The `$` names nothing here answers to, reported on the surface (ADR-0082). */
  protected readonly unknownFacetKeys = computed(() => this.parsedQuery().unresolvedKeys);

  /** The **rail store**: what was clicked. Value-equal so the URL round-trip's echo doesn't re-trigger
   * the fetch effect. The type facet is pinned to the asset type here, so it is never carried in `type`. */
  private readonly railFacets = signal<ActiveFacets>(NO_FACETS, {
    equal: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });

  /** The one filter state, `parse(text) ∪ railState` — what the rail renders and the wire carries. The
   * same value-equality: a text edit that leaves the filters alone must not refetch on their account. */
  protected readonly activeFacets = computed(() => unionFacets(this.parsedQuery(), this.railFacets()), {
    equal: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });
  /** The rail counts with the type category stripped — the asset type is pinned, never a rail choice. */
  protected readonly facetCounts = signal<EntityFacets>(NO_FACET_COUNTS);
  /** Both polarities count as a filter (ADR-0081), so Clear all is offered — and clears — either. */
  protected readonly hasFilters = computed(() => {
    const f = this.activeFacets();
    return (
      this.hasQuery() ||
      f.tag.length > 0 ||
      f.visibility.length > 0 ||
      Object.keys(f.fields).length > 0 ||
      Object.values(f.excluded ?? {}).some((values) => (values?.length ?? 0) > 0)
    );
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
          // The exclusions ride the URL like their positive twins (ADR-0081), so "art not already
          // tagged as used" survives a refresh and shares as a link.
          excludeTag: params.getAll('excludeTag'),
          excludeVisibility: params.getAll('excludeVisibility'),
        })),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        takeUntilDestroyed(),
      )
      .subscribe((f) => {
        this.rawQuery.set(f.q);
        this.railFacets.set({
          type: [],
          tag: f.tag,
          visibility: f.visibility,
          // This rail carries the exclude control, so a `neq` token is honoured rather than dropped.
          fields: fieldsFromTokens(f.field, true),
          container: [],
          excluded: { tag: f.excludeTag, visibility: f.excludeVisibility },
        });
      });

    this.typed.pipe(debounceTime(SEARCH_DEBOUNCE_MS), takeUntilDestroyed()).subscribe((raw) => {
      // Kept verbatim, untrimmed: a trailing space is inside a `$tag:"sea of ` still being typed, and
      // the box must go on holding exactly what was typed (ADR-0082). The parser trims the residual.
      this.setQuery(raw);
    });

    effect(() => {
      this.searchText(); // tracked
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

  /** Toggle one category value in the polarity the pressed control names; the other is released.
   * Against the rail store alone — a clicked Facet lives in the rail, and never writes text (ADR-0082). */
  protected toggleFacet({ category, value, polarity }: FacetToggle): void {
    if (this.namedInText(category, value)) return this.dropToken({ category, value });
    const current = this.railFacets();
    const next = togglePolarity(current[category], current.excluded?.[category] ?? [], value, polarity);
    this.applyFacets({
      ...current,
      [category]: next.included,
      excluded: { ...current.excluded, [category]: next.excluded },
    });
  }

  /** As in a category, pressing either polarity of a Field value releases the other (ADR-0081). */
  protected toggleFieldValue({ key, value, polarity }: FieldValueToggle): void {
    if (this.fieldNamedInText(key, (f) => (f.op === 'eq' || f.op === 'neq') && f.value === value))
      return this.dropToken({ field: key, value });
    const current = this.railFacets();
    const sel = current.fields[key] ?? {};
    const next = togglePolarity(sel.values ?? [], sel.excluded ?? [], value, polarity);
    this.setFieldSelection(current, key, { ...sel, values: next.included, excluded: next.excluded });
  }

  protected changeFieldRange({ key, bound, value }: FieldRangeChange): void {
    if (this.fieldNamedInText(key, (f) => f.op === bound)) return;
    const current = this.railFacets();
    const sel = current.fields[key] ?? {};
    this.setFieldSelection(current, key, { ...sel, [bound]: value || undefined });
  }

  /**
   * The one rail→text write in the design, and always a deletion (ADR-0082): a click on a row the text
   * owns takes the token that named it out of the box, whichever of the row's two controls was pressed.
   * The rail store is left alone — a value it holds from an earlier click was only being masked by the
   * text, and stays in force, one more click from release.
   */
  private dropToken(target: FacetTokenTarget): void {
    this.setQuery(removeFacetToken(this.rawQuery(), this.facetKeys(), target));
  }

  /** Commit the text store: the box's raw string, mirrored to the URL's `q`. Merge keeps the World
   * scope; replaceUrl avoids a history entry per keystroke. */
  private setQuery(raw: string): void {
    this.rawQuery.set(raw);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { q: raw || null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /**
   * Whether the text already names this value, in either polarity — in which case the rail must not
   * write it: the text owns it, the union would hide the rail's copy, and backspacing the token later
   * would leave a filter nobody clicked. A click on such a row deletes the token instead
   * ({@link dropToken}), which is where a typed Facet is reversed (ADR-0082).
   */
  private namedInText(category: FacetCategory, value: string): boolean {
    const parsed = this.parsedQuery();
    return parsed.include[category].includes(value) || parsed.exclude[category].includes(value);
  }

  /** The same rule for a Facet key's rail controls — a typed value, or a typed bound. */
  private fieldNamedInText(key: string, matches: (filter: FieldFilter) => boolean): boolean {
    return this.parsedQuery().fields.some((f) => f.key === key && matches(f));
  }

  private setFieldSelection(current: ActiveFacets, key: string, sel: FieldSelection): void {
    const fields = { ...current.fields };
    const pruned = pruneField(sel);
    if (pruned) fields[key] = pruned;
    else delete fields[key];
    this.applyFacets({ ...current, fields });
  }

  /** Commit a new rail-store set: update the signal and mirror it to the URL. */
  private applyFacets(updated: ActiveFacets): void {
    this.railFacets.set(updated);
    this.mirrorToUrl(updated);
  }

  /** Clears both stores — a typed Facet is as cleared as a clicked one, and the box empties with it. */
  protected clearAll(): void {
    this.rawQuery.set('');
    this.railFacets.set(NO_FACETS);
    this.router.navigate([], {
      relativeTo: this.route,
      // Clear all clears both polarities (ADR-0081).
      queryParams: { q: null, tag: null, visibility: null, field: null, excludeTag: null, excludeVisibility: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private mirrorToUrl(facets: ActiveFacets): void {
    const field = fieldTokens(facets.fields);
    const excluded = facets.excluded ?? {};
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        tag: facets.tag.length ? [...facets.tag] : null,
        visibility: facets.visibility.length ? [...facets.visibility] : null,
        field: field.length ? field : null,
        excludeTag: excluded.tag?.length ? [...excluded.tag] : null,
        excludeVisibility: excluded.visibility?.length ? [...excluded.visibility] : null,
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
    // The residual text, not the raw box: the tokens have become params by here (ADR-0082).
    const q = this.searchText();
    const f = this.activeFacets();
    const excluded = f.excluded ?? {};
    const field = fieldTokens(f.fields);
    return {
      ...(q ? { q } : {}),
      ...(f.tag.length ? { tag: [...f.tag] } : {}),
      ...(f.visibility.length ? { visibility: [...f.visibility] as Visibility[] } : {}),
      ...(field.length ? { field } : {}),
      // The excluding half, sent on the list and the Facet read alike (ADR-0081).
      ...(excluded.tag?.length ? { excludeTag: [...excluded.tag] } : {}),
      ...(excluded.visibility?.length ? { excludeVisibility: [...excluded.visibility] as Visibility[] } : {}),
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
