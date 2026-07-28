import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, Subscription, debounceTime, distinctUntilChanged, finalize, map } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { CompendiumSummary, EntityFacets, EntitySummary, EntityType } from '@hexly/domain';
import {
  ActiveWorld,
  AppShellStore,
  CompendiumsClient,
  EntitiesClient,
  EntityFacetParams,
  ToasterService,
  worldCompendiumPageRoute,
} from '@hexly/web-core';
import { EyebrowComponent, ButtonComponent, PageHeaderComponent } from '@hexly/web-ui';
import { EntityCardComponent, EntityCardVm } from '../entity-browser/components/entity-card.component';
import { EntitySearchComponent } from '../entity-browser/components/entity-search.component';
import { EmptyStateComponent } from '../entity-browser/components/empty-state.component';
import {
  ActiveFacets,
  FacetRailComponent,
  FacetToggle,
  FieldRangeChange,
  FieldSelection,
  FieldValueToggle,
} from '../entity-browser/components/facet-rail.component';
import { fieldTokens, fieldsFromTokens, pruneField } from '../entity-browser/components/field-facet-url';

const NO_FACETS: ActiveFacets = { type: [], tag: [], visibility: [], fields: {}, compendium: [] };
const NO_FACET_COUNTS: EntityFacets = { type: [], tag: [], visibility: [], fields: [] };

// A bounded first page, like the Entity Browser, so a bestiary of hundreds loads fast.
const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 150;

/**
 * The **Compendium browse** (`/w/:worldId/compendium`, ADR-0079): the **Entity Browser** preset to the
 * installed **Compendiums**, on the Asset Browser's precedent — same list, same search, same Facet rail.
 *
 * It names its Containers explicitly, read from `/compendiums` before the first list, because the read
 * is about compendium content rather than about a World; the packs' own dimensions (role, organization,
 * level) then arrive as Field facets by the ordinary presence rule. The `:worldId` names the
 * **Adoption** target, not the content's home (#403).
 *
 * Read-only is inherited, never special-cased: a **Compendium Entry**'s Rights are `read` alone, so the
 * shared card's own gate hides rename and delete.
 */
@Component({
  selector: 'app-compendium-browser',
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
    RouterLink,
  ],
  host: { class: 'block min-h-full bg-surface-sunken' },
  template: `
    <app-page-header sticky>
      <div pageHeaderTitle class="flex flex-col">
        <span appEyebrow class="text-accent-strong! tracking-[0.28em]">{{ 'compendium.eyebrow' | transloco }}</span>
        <h1 class="font-display text-[22px] text-ink-strong m-0 leading-tight">
          {{ 'compendium.heading' | transloco }}
        </h1>
      </div>
      <span pageHeaderActions class="font-sans text-xs text-ink-muted" data-testid="compendium-read-only">{{
        'compendium.subheading' | transloco
      }}</span>
    </app-page-header>

    <main class="max-w-[72rem] mx-auto py-8 px-6">
      <!-- The Entity Browser's own search box, verbatim (the Asset Browser's precedent): same control,
           same copy, same behaviour — there is no second way to search. -->
      <app-entity-search [value]="query()" (queryChange)="onSearch($event)" />

      <!-- The credit line: every installed Compendium named, each linking to its **Compendium page**
           and the terms it states (ADR-0061, #402). Names them all, whatever the Compendium facet
           narrows to — the credit is the shelf's, not the result set's. -->
      @if (credits().length > 0) {
        <p class="font-sans text-xs text-ink-muted m-0 mb-6" data-testid="compendium-credits">
          {{ 'compendium.credits' | transloco }}
          @for (compendium of credits(); track compendium.id; let last = $last) {
            <a
              class="text-accent-strong hover:underline"
              [attr.data-testid]="'compendium-credit-' + compendium.id"
              [routerLink]="pageRoute(compendium)"
              >{{ compendium.name }}</a
            >{{ last ? '' : ', ' }}
          }
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
          @if (cards().length > 0) {
            <ul class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 m-0 p-0 list-none">
              @for (card of cards(); track card.id) {
                <li class="contents">
                  <app-entity-card [card]="card" [worldId]="worldId()" />
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
                  {{ (loadingMore() ? 'compendium.loadingMore' : 'compendium.loadMore') | transloco }}
                </button>
              </div>
            }
          } @else if (loadError()) {
            <app-empty-state
              testid="load-error"
              [title]="'compendium.loadErrorTitle' | transloco"
              [hint]="'compendium.loadErrorHint' | transloco"
            />
          } @else if (loaded() && hasFilters()) {
            <app-empty-state
              testid="no-matches"
              [title]="'compendium.noMatchTitle' | transloco"
              [hint]="'compendium.noMatchHint' | transloco"
            />
          } @else if (loaded()) {
            <app-empty-state
              testid="empty"
              [title]="'compendium.emptyTitle' | transloco"
              [hint]="'compendium.emptyHint' | transloco"
            />
          }
        </div>
      </div>
    </main>
  `,
})
export class CompendiumBrowserPage {
  private readonly entitiesClient = inject(EntitiesClient);
  private readonly compendiumsClient = inject(CompendiumsClient);
  private readonly activeWorld = inject(ActiveWorld);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);
  private readonly shell = inject(AppShellStore);

  /** The adoption target, not the content's home — what an entry's link carries (#403). */
  protected readonly worldId = this.activeWorld.worldId;

  /**
   * The installed **Compendiums**. `null` until they load, because a read naming no Container is an
   * unscoped read of every Entity on the Instance — not an empty one.
   */
  private readonly installed = signal<CompendiumSummary[] | null>(null);

  /** The credit line's rows: nothing to credit until the Compendiums load. */
  protected readonly credits = computed(() => this.installed() ?? []);

  private readonly _entries = signal<EntitySummary[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loadingMore = signal(false);
  protected readonly loaded = signal(false);
  protected readonly loadError = signal(false);

  /** Debounced full-text query; empty means the default last-edited view. Mirrored to the URL `q`. */
  protected readonly query = signal('');
  private readonly typed = new Subject<string>();

  /** Value-equal so the URL round-trip's echo doesn't re-trigger the fetch effect. */
  protected readonly activeFacets = signal<ActiveFacets>(NO_FACETS, {
    equal: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });
  /** The rail counts with Visibility stripped: it is inert on a shelf nobody may re-expose (ADR-0079). */
  protected readonly facetCounts = signal<EntityFacets>(NO_FACET_COUNTS);
  protected readonly hasFilters = computed(() => {
    const f = this.activeFacets();
    return (
      this.query() !== '' ||
      f.type.length > 0 ||
      f.tag.length > 0 ||
      f.compendium.length > 0 ||
      Object.keys(f.fields).length > 0
    );
  });

  /** Server order is authoritative (relevance under a query, updatedAt desc otherwise) — rendered verbatim. */
  protected readonly cards = computed<EntityCardVm[]>(() =>
    this._entries().map((entry) => ({
      id: entry.id,
      title: entry.name,
      type: entry.types[0],
      tags: entry.tags,
      updatedAt: entry.updatedAt,
      // Carried through untouched: `read` alone is what makes the card offer no rename and no delete,
      // so the read-only rendering is the seal's own doing rather than this page's (ADR-0079).
      rights: entry.rights,
      ...(entry.thumbnailUrl ? { thumbnailUrl: entry.thumbnailUrl } : {}),
    })),
  );

  private facetsSub?: Subscription;
  private fetchSub?: Subscription;
  private loadMoreSub?: Subscription;

  constructor() {
    // Seed query + Facets from the URL and follow back/forward, before the fetch effect so the first
    // emission lands before the first fetch (one request on load).
    this.route.queryParamMap
      .pipe(
        map((params) => ({
          q: params.get('q') ?? '',
          type: params.getAll('type'),
          tag: params.getAll('tag'),
          compendium: params.getAll('compendium'),
          field: params.getAll('field'),
        })),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        takeUntilDestroyed(),
      )
      .subscribe((f) => {
        this.query.set(f.q);
        this.activeFacets.set({
          type: f.type,
          tag: f.tag,
          // Inert here: nobody may re-expose a shelf, so the category is stripped from the counts.
          visibility: [],
          fields: fieldsFromTokens(f.field),
          compendium: f.compendium,
        });
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

    // Instance-wide (ADR-0078), so the Container set does not change with the active World — read once.
    this.compendiumsClient.list().subscribe({
      next: (compendiums) => this.installed.set(compendiums),
      error: () => {
        this.installed.set([]);
        this.loadError.set(true);
        this.loaded.set(true);
      },
    });

    effect(() => {
      this.query(); // tracked
      this.activeFacets(); // tracked
      if (this.installed() !== null) this.fetchFirstPage();
    });
  }

  protected onSearch(value: string): void {
    this.typed.next(value);
  }

  /** One Compendium's own page, under the World this browse was entered from. */
  protected pageRoute(compendium: CompendiumSummary): string[] {
    return worldCompendiumPageRoute(
      this.worldId() ?? '',
      compendium.id,
      this.activeWorld.name() ?? undefined,
      compendium.name,
    );
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
      queryParams: { q: null, type: null, tag: null, compendium: null, field: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private mirrorToUrl(facets: ActiveFacets): void {
    const field = fieldTokens(facets.fields);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        type: facets.type.length ? [...facets.type] : null,
        tag: facets.tag.length ? [...facets.tag] : null,
        // Only the *selection* rides the URL, never the scope: a shared link is meant to keep meaning
        // after another Compendium is installed.
        compendium: facets.compendium.length ? [...facets.compendium] : null,
        field: field.length ? field : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** Fetch page one and replace the accumulated list — on load and after every filter change. */
  private fetchFirstPage(): void {
    const containerId = this.containerScope();
    this.fetchSub?.unsubscribe();
    this.loadMoreSub?.unsubscribe();
    this.loadingMore.set(false);
    this.nextCursor.set(null);
    this.loadError.set(false);
    // Nothing installed: an empty scope would read every Entity on the Instance, so answer it here.
    if (containerId.length === 0) {
      this._entries.set([]);
      this.facetCounts.set(NO_FACET_COUNTS);
      this.loaded.set(true);
      return;
    }
    const params = this.activeFilterParams();
    // Rights opted in for the card's action gate, which is what renders an entry read-only (ADR-0039).
    this.fetchSub = this.entitiesClient
      .list({ limit: PAGE_SIZE, containerId, rights: true, thumbnails: true, ...params })
      .pipe(this.shell.withLoading('subtle'))
      .subscribe({
        next: (page) => {
          this._entries.set(page.items);
          this.nextCursor.set(page.nextCursor);
          this.loaded.set(true);
        },
        error: () => {
          if (this._entries().length === 0) {
            this.loaded.set(true);
            this.loadError.set(true);
          }
        },
      });
    this.fetchFacetCounts(containerId, params);
  }

  /** Every installed Compendium — the Containers this read names explicitly (ADR-0079). */
  private containerScope(): string[] {
    return (this.installed() ?? []).map((compendium) => compendium.id);
  }

  private activeFilterParams(): EntityFacetParams {
    const q = this.query();
    const f = this.activeFacets();
    const field = fieldTokens(f.fields);
    return {
      ...(q ? { q } : {}),
      ...(f.type.length ? { type: [...f.type] as EntityType[] } : {}),
      ...(f.tag.length ? { tag: [...f.tag] } : {}),
      ...(f.compendium.length ? { compendium: [...f.compendium] } : {}),
      ...(field.length ? { field } : {}),
    };
  }

  /** Facet counts over the same scope; Visibility is stripped — inert on a shelf nobody may re-expose. */
  private fetchFacetCounts(containerId: string[], params: EntityFacetParams): void {
    this.facetsSub?.unsubscribe();
    this.facetsSub = this.entitiesClient.facets({ containerId, ...params }).subscribe({
      next: (facets) => this.facetCounts.set({ ...facets, visibility: [] }),
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
        containerId: this.containerScope(),
        rights: true,
        thumbnails: true,
        ...this.activeFilterParams(),
      })
      .pipe(finalize(() => this.loadingMore.set(false)))
      .subscribe({
        next: (page) => {
          this._entries.update((items) => [...items, ...page.items]);
          this.nextCursor.set(page.nextCursor);
        },
        error: () => this.toaster.show(this.transloco.translate('compendium.loadMoreError'), 'error'),
      });
  }
}
