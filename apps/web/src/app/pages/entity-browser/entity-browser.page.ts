import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
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
import { EntitiesClient, EntityFacetParams, ActiveWorld, ToasterService, AppShellStore } from '@hexly/web-core';
import { ButtonComponent, DialogService, EyebrowComponent, PageHeaderComponent } from '@hexly/web-ui';
import { NewEntityButtonComponent } from '../../entity-types/new-entity-button.component';
import { DeleteEntityDialogComponent, DeleteEntityDialogData } from '../../entity-types/delete-entity-dialog.component';
import { EntityCardComponent } from './components/entity-card.component';
import { EntitySearchComponent } from './components/entity-search.component';
import { EmptyStateComponent } from './components/empty-state.component';
import {
  ActiveFacets,
  FacetCategory,
  FacetRailComponent,
  FacetToggle,
  FieldRangeChange,
  FieldSelection,
  FieldValueToggle,
  togglePolarity,
} from './components/facet-rail.component';
import { fieldTokens, fieldsFromTokens, pruneField } from './components/field-facet-url';
import { queryOwnedFacets, unionFacets } from './components/facet-token-union';
import { TypeRegistry } from '../../entity-types/type-registry';

const NO_FACETS: ActiveFacets = {
  type: [],
  tag: [],
  visibility: [],
  fields: {},
  // Never filled here: the server offers the Container facet only where a read spans more than one
  // Container, and the Entity Browser is scoped to one World — a Mounted one included (ADR-0080).
  container: [],
  // The excluding half (ADR-0081). No `container` for the same reason its positive twin has none.
  excluded: { type: [], tag: [], visibility: [] },
};

const NO_FACET_COUNTS: EntityFacets = {
  type: [],
  tag: [],
  visibility: [],
  fields: [],
};

// ponytail: bounded first page so a large vault loads fast; bump or make
// configurable only if a real page size proves wrong in use.
const PAGE_SIZE = 50;

// Same 150ms the shared searchEntities helper uses for autocomplete.
const SEARCH_DEBOUNCE_MS = 150;

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
          } @else if (loaded() && hasQuery()) {
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
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);
  private readonly shell = inject(AppShellStore);
  private readonly dialogs = inject(DialogService);
  /** The client registry a Facet Token's key resolves against, synchronously (ADR-0082). */
  private readonly types = inject(TypeRegistry);

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

  /**
   * The **text store** (ADR-0082): the box exactly as it was typed, debounced and never rewritten here.
   * Source of truth for the URL `q` mirror, which carries this *raw* string; the wire carries
   * {@link searchText}, the residual after every token is lifted out.
   */
  protected readonly rawQuery = signal('');
  private readonly typed = new Subject<string>();

  /**
   * This surface's Facet vocabulary, from the client registry, synchronously — minus `in`: a browse
   * scoped to one **Container** has nothing to narrow, so `$in:` is reported as a miss rather than
   * dropped (ADR-0082). One set, read thrice: the parser resolves against it, the box offers it on
   * `$`, and a rail click finds the token it deletes by it.
   */
  protected readonly facetKeys = computed<FacetKeySet>(() => ({
    reserved: ['type', 'tag', 'visibility'],
    fields: this.types.facetKeys(),
  }));
  /** What the box means: its **Facet Tokens** as structured filters and the free text left over. */
  protected readonly parsedQuery = computed(() => parseFacetQuery(this.rawQuery(), this.facetKeys()));
  /** Which rail rows the text owns, so they render as query-owned and click off as a token (#425). */
  protected readonly queryOwned = computed(() => queryOwnedFacets(this.parsedQuery()));
  /** The residual full-text query — what the wire's `q` carries, as against the URL's raw string. */
  private readonly searchText = computed(() => this.parsedQuery().text);
  /** Whether the box holds anything at all to search or filter by — blanks are not a query. */
  protected readonly hasQuery = computed(() => this.rawQuery().trim() !== '');
  /** The `$` names nothing here answers to, reported on the surface (ADR-0082). */
  protected readonly unknownFacetKeys = computed(() => this.parsedQuery().unresolvedKeys);

  /** The **rail store**: what was clicked. Value-equal so the URL round-trip's echo (a fresh object,
   * same values) doesn't re-trigger the fetch effect — one refetch per toggle. */
  private readonly railFacets = signal<ActiveFacets>(NO_FACETS, {
    equal: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });

  /** The one filter state, `parse(text) ∪ railState` — what the rail renders and the wire carries. The
   * same value-equality: a text edit that leaves the filters alone must not refetch on their account. */
  protected readonly activeFacets = computed(() => unionFacets(this.parsedQuery(), this.railFacets()), {
    equal: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });
  protected readonly facetCounts = signal<EntityFacets>(NO_FACET_COUNTS);
  /** Both polarities count as a filter (ADR-0081), so Clear all is offered — and clears — either. */
  protected readonly hasFilters = computed(() => {
    const f = this.activeFacets();
    return (
      this.hasQuery() ||
      f.type.length > 0 ||
      f.tag.length > 0 ||
      f.visibility.length > 0 ||
      Object.keys(f.fields).length > 0 ||
      Object.values(f.excluded ?? {}).some((values) => (values?.length ?? 0) > 0)
    );
  });

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
    // Seed query + Facets from the URL and follow back/forward. Subscribed before
    // the fetch effect so the synchronous first emission lands before the first
    // fetch — one request on load. The distinctUntilChanged absorbs the echo when
    // a toggle's own navigate round-trips back, so there's no read/write loop.
    this.route.queryParamMap
      .pipe(
        map((params) => ({
          q: params.get('q') ?? '',
          type: params.getAll('type'),
          tag: params.getAll('tag'),
          visibility: params.getAll('visibility'),
          field: params.getAll('field'),
          // The exclusions ride the URL like their positive twins (ADR-0081), so a narrowed browse
          // survives a refresh and shares as a link.
          excludeType: params.getAll('excludeType'),
          excludeTag: params.getAll('excludeTag'),
          excludeVisibility: params.getAll('excludeVisibility'),
        })),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        takeUntilDestroyed(),
      )
      .subscribe((f) => {
        this.rawQuery.set(f.q);
        this.railFacets.set({
          type: f.type,
          tag: f.tag,
          visibility: f.visibility,
          // This rail carries the exclude control, so a `neq` token is honoured rather than dropped.
          fields: fieldsFromTokens(f.field, true),
          container: [],
          excluded: {
            type: f.excludeType,
            tag: f.excludeTag,
            visibility: f.excludeVisibility,
          },
        });
      });

    this.typed.pipe(debounceTime(SEARCH_DEBOUNCE_MS), takeUntilDestroyed()).subscribe((raw) => {
      // Kept verbatim, untrimmed: a trailing space is inside a `$tag:"sea of ` still being typed, and
      // the box must go on holding exactly what was typed (ADR-0082). The parser trims the residual.
      this.setQuery(raw);
    });

    // Refetch page one whenever the World, query, or Facets change — covers a
    // param-only switch between Worlds (same component instance).
    effect(() => {
      this.searchText(); // tracked
      this.activeFacets(); // tracked
      if (this.activeWorld.worldId()) this.fetchFirstPage();
    });
  }

  protected onSearch(value: string): void {
    this.typed.next(value);
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

  /** Toggle one enum/list/string Field-facet value: `eq` membership (OR within the Field), or its
   * `neq` veto. As in a category, pressing either polarity releases the other. */
  protected toggleFieldValue({ key, value, polarity }: FieldValueToggle): void {
    if (this.fieldNamedInText(key, (f) => (f.op === 'eq' || f.op === 'neq') && f.value === value))
      return this.dropToken({ field: key, value });
    const current = this.railFacets();
    const sel = current.fields[key] ?? {};
    const next = togglePolarity(sel.values ?? [], sel.excluded ?? [], value, polarity);
    this.setFieldSelection(current, key, { ...sel, values: next.included, excluded: next.excluded });
  }

  /** Set (or clear) one bound of a number/date Field range. */
  protected changeFieldRange({ key, bound, value }: FieldRangeChange): void {
    if (this.fieldNamedInText(key, (f) => f.op === bound)) return;
    const current = this.railFacets();
    const sel = current.fields[key] ?? {};
    this.setFieldSelection(current, key, {
      ...sel,
      [bound]: value || undefined,
    });
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

  /** Fold a Field selection back into the active facets, pruning it away once empty. */
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
      queryParams: {
        q: null,
        type: null,
        tag: null,
        visibility: null,
        field: null,
        // Clear all clears both polarities (ADR-0081).
        excludeType: null,
        excludeTag: null,
        excludeVisibility: null,
      },
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
        type: facets.type.length ? [...facets.type] : null,
        tag: facets.tag.length ? [...facets.tag] : null,
        visibility: facets.visibility.length ? [...facets.visibility] : null,
        field: field.length ? field : null,
        excludeType: excluded.type?.length ? [...excluded.type] : null,
        excludeTag: excluded.tag?.length ? [...excluded.tag] : null,
        excludeVisibility: excluded.visibility?.length ? [...excluded.visibility] : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
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
    const params = this.activeFilterParams();
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

  private activeFilterParams(): EntityFacetParams {
    // The residual text, not the raw box: the tokens have become params by here (ADR-0082).
    const q = this.searchText();
    const f = this.activeFacets();
    const excluded = f.excluded ?? {};
    const field = fieldTokens(f.fields);
    return {
      ...(q ? { q } : {}),
      ...(f.type.length ? { type: [...f.type] as EntityType[] } : {}),
      ...(f.tag.length ? { tag: [...f.tag] } : {}),
      ...(f.visibility.length ? { visibility: [...f.visibility] as Visibility[] } : {}),
      ...(field.length ? { field } : {}),
      // The excluding half, sent on the list and the Facet read alike (ADR-0081).
      ...(excluded.type?.length ? { excludeType: [...excluded.type] as EntityType[] } : {}),
      ...(excluded.tag?.length ? { excludeTag: [...excluded.tag] } : {}),
      ...(excluded.visibility?.length ? { excludeVisibility: [...excluded.visibility] as Visibility[] } : {}),
    };
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
        ...this.activeFilterParams(),
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
