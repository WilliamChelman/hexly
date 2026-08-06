import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, Subscription, debounceTime, distinctUntilChanged, finalize, map } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { EntityFacets, EntitySummary, EntityType, Mount } from '@hexly/domain';
import {
  ActiveWorld,
  AppShellStore,
  EntitiesClient,
  EntityFacetParams,
  ToasterService,
  WorldsClient,
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

const NO_FACETS: ActiveFacets = { type: [], tag: [], visibility: [], fields: {}, container: [] };
const NO_FACET_COUNTS: EntityFacets = { type: [], tag: [], visibility: [], fields: [] };

// A bounded first page, like the Entity Browser, so a shelf of hundreds loads fast.
const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 150;

/**
 * The **Library** (`/w/:worldId/library`, ADR-0080): every Entity of every **Container** this World
 * **Mounts**. The **Entity Browser** preset to the Mount set, on the Asset Browser's precedent — same
 * list, same search, same Facet rail. An installed **Compendium** is one value the **Container** facet
 * takes, a mounted **Shelf** another, read in the Owner's Mount order (ADR-0079).
 *
 * It names its Containers explicitly, read from `/worlds/:id/mounts` before the first list, because the
 * read is *about* foreign content rather than about a World; those Containers' own dimensions then
 * arrive as Field facets by the ordinary presence rule. The `:worldId` names whose Mounts these are and
 * the **Adoption** target — never the content's home.
 *
 * That read is the World's members' — the cascade is one hop, so what a World reached *through* a Mount
 * itself draws from is withheld (ADR-0080). A non-member reader is therefore shown nothing rather than a
 * failure: they reached a World they may read, and this one surface is not theirs.
 *
 * Read-only is inherited, never special-cased: a **Compendium Entry**'s Rights are `read` alone, so the
 * shared card's own gate hides rename and delete, and its `sealed` flag is what offers **Adoption**.
 */
@Component({
  selector: 'app-library',
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
        <span appEyebrow class="text-accent-strong! tracking-[0.28em]">{{ 'library.eyebrow' | transloco }}</span>
        <h1 class="font-display text-[22px] text-ink-strong m-0 leading-tight">
          {{ 'library.heading' | transloco }}
        </h1>
      </div>
      <!-- Not "read-only": a mounted **Shelf** you Own is yours to edit, at its own page (ADR-0080). -->
      <span pageHeaderActions class="font-sans text-xs text-ink-muted" data-testid="library-subheading">{{
        'library.subheading' | transloco
      }}</span>
    </app-page-header>

    <main class="max-w-[72rem] mx-auto py-8 px-6">
      <!-- The Entity Browser's own search box, verbatim — the Asset Browser's precedent. -->
      <app-entity-search [value]="query()" (queryChange)="onSearch($event)" />

      <!-- The credit line: every mounted **Compendium**, linked to the **Compendium page** stating its
           terms (ADR-0061). All of them whatever the Container facet narrows to, since the credit is
           owed by the Mount set rather than by the result set; a mounted World states no terms, so it
           is credited nowhere. -->
      @if (credits().length > 0) {
        <p class="font-sans text-xs text-ink-muted m-0 mb-6" data-testid="library-credits">
          {{ 'library.credits' | transloco }}
          @for (pack of credits(); track pack.containerId; let last = $last) {
            <a
              class="text-accent-strong hover:underline"
              [attr.data-testid]="'library-credit-' + pack.containerId"
              [routerLink]="pageRoute(pack)"
              >{{ pack.name }}</a
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
                  <app-entity-card [card]="card" [worldId]="worldId()" (adopt)="adopt(card)" />
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
                  {{ (loadingMore() ? 'library.loadingMore' : 'library.loadMore') | transloco }}
                </button>
              </div>
            }
          } @else if (loadError()) {
            <app-empty-state
              testid="load-error"
              [title]="'library.loadErrorTitle' | transloco"
              [hint]="'library.loadErrorHint' | transloco"
            />
          } @else if (membersOnly()) {
            <!-- Ahead of every emptiness: this reader was told nothing, which is not the same as being
                 told there is nothing (ADR-0080). -->
            <app-empty-state
              testid="members-only"
              [title]="'library.membersOnlyTitle' | transloco"
              [hint]="'library.membersOnlyHint' | transloco"
            />
          } @else if (loaded() && mounts().length === 0) {
            <!-- Ahead of the search-miss branch: with nothing mounted there is nothing to search, so a
                 query must not be told it failed (ADR-0080). -->
            <app-empty-state
              testid="no-mounts"
              [title]="'library.noMountsTitle' | transloco"
              [hint]="'library.noMountsHint' | transloco"
            />
          } @else if (loaded() && hasFilters()) {
            <app-empty-state
              testid="no-matches"
              [title]="'library.noMatchTitle' | transloco"
              [hint]="'library.noMatchHint' | transloco"
            />
          } @else if (loaded()) {
            <app-empty-state
              testid="empty"
              [title]="'library.emptyTitle' | transloco"
              [hint]="'library.emptyHint' | transloco"
            />
          }
        </div>
      </div>
    </main>
  `,
})
export class LibraryPage {
  private readonly entitiesClient = inject(EntitiesClient);
  private readonly worldsClient = inject(WorldsClient);
  private readonly activeWorld = inject(ActiveWorld);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);
  private readonly shell = inject(AppShellStore);
  private readonly destroyRef = inject(DestroyRef);

  /** Whose Mounts these are, and the Adoption target — never the content's home (ADR-0080). */
  protected readonly worldId = this.activeWorld.worldId;

  /**
   * The World's **Mounts**, in the Owner's order. `null` until they load, because a read naming no
   * Container is an unscoped read of every Entity the caller can reach — not an empty one.
   */
  private readonly mounted = signal<Mount[] | null>(null);

  /** The Mount set once known; empty both before it loads and where a World Mounts nothing. */
  protected readonly mounts = computed(() => this.mounted() ?? []);

  /** The credit line's rows: the mounted **Compendiums**, the only Containers that state terms. */
  protected readonly credits = computed(() => this.mounts().filter((m) => m.kind === 'compendium'));

  private readonly _entries = signal<EntitySummary[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loadingMore = signal(false);
  protected readonly loaded = signal(false);
  /**
   * One failure to the reader, two flags underneath: they clear on different beats — the list's on
   * every refetch, the Mount set's only on a re-read of it — so a single flag would let a refetch
   * clear a Mount-read failure and leave that World claiming to draw on nothing.
   */
  protected readonly loadError = computed(() => this.mountsError() || this.listError());
  private readonly mountsError = signal(false);
  private readonly listError = signal(false);

  /**
   * Whether the Mount set was withheld rather than unavailable: the read is member-gated, because the
   * cascade is one hop and naming what *this* World draws from would disclose the second (ADR-0080).
   * Its own state, not `loadError`: nothing went wrong, so nothing may say so.
   */
  protected readonly membersOnly = signal(false);

  /** Debounced full-text query; empty means the default last-edited view. Mirrored to the URL `q`. */
  protected readonly query = signal('');
  private readonly typed = new Subject<string>();

  /** Value-equal so the URL round-trip's echo doesn't re-trigger the fetch effect. */
  protected readonly activeFacets = signal<ActiveFacets>(NO_FACETS, {
    equal: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });
  /**
   * The rail counts with Visibility stripped. Visibility is the *owning* Container's business, and
   * nothing here can act on it: a pack's entries are stored `private` yet read by every signed-in
   * caller, so the category would annotate this list with a word that is false of it (ADR-0079).
   */
  protected readonly facetCounts = signal<EntityFacets>(NO_FACET_COUNTS);
  protected readonly hasFilters = computed(() => {
    const f = this.activeFacets();
    return (
      this.query() !== '' ||
      f.type.length > 0 ||
      f.tag.length > 0 ||
      f.container.length > 0 ||
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
      // Carried through untouched, so read-only rendering is the seal's doing and not this page's: the
      // card's own gate reads them, and a mounted World's Entity keeps its Container's grant (ADR-0079).
      rights: entry.rights,
      // What the **Adopt** action hangs off (#403) — location, derived by the server and never stored.
      sealed: entry.sealed,
      ...(entry.thumbnailUrl ? { thumbnailUrl: entry.thumbnailUrl } : {}),
    })),
  );

  private mountsSub?: Subscription;
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
          container: params.getAll('container'),
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
          // Inert here: see {@link facetCounts} — the category is stripped from the counts.
          visibility: [],
          fields: fieldsFromTokens(f.field),
          container: f.container,
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

    // The Mount set is a property of the active World, so it is re-read when the World changes — and
    // by every reader of it, not just its Owners: this is the read the Library is (ADR-0080, #412).
    // One tracked subscription, so a World switch mid-flight cannot land the old World's Mounts.
    effect(() => {
      const worldId = this.worldId();
      if (!worldId) return;
      this.mountsSub?.unsubscribe();
      this.mountsError.set(false);
      this.membersOnly.set(false);
      this.mountsSub = this.worldsClient
        .mounts(worldId)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (mounts) => this.mounted.set(mounts),
          error: (err: unknown) => {
            // Not the empty Mount set: "we could not ask" and "it draws on nothing" are different
            // answers, and the one the ticket asks for is the second (#412). A refusal is a third:
            // a reader who reaches this World through someone else's Mount is not a member of it, and
            // what they have no standing for is suppressed rather than reported as a failure.
            this.mounted.set([]);
            if (err instanceof HttpErrorResponse && err.status === 403) this.membersOnly.set(true);
            else this.mountsError.set(true);
            this.loaded.set(true);
          },
        });
    });

    effect(() => {
      this.query(); // tracked
      this.activeFacets(); // tracked
      if (this.mounted() !== null) this.fetchFirstPage();
    });
  }

  protected onSearch(value: string): void {
    this.typed.next(value);
  }

  /** One mounted Compendium's own page, under the World whose Library credited it. */
  protected pageRoute(pack: Mount): string[] {
    return worldCompendiumPageRoute(
      this.worldId() ?? '',
      pack.containerId,
      this.activeWorld.name() ?? undefined,
      pack.name,
    );
  }

  /**
   * **Adopt** an entry into the World this Library is read under (ADR-0079). The list is left as it was
   * and a toast reports instead: asking twice adopts twice, so nothing here may claim "already adopted".
   */
  protected adopt(card: EntityCardVm): void {
    const worldId = this.worldId();
    if (!worldId) return;
    this.entitiesClient
      .adopt(card.id, worldId)
      // Not one tracked subscription like the reads below: two adoptions of one entry are a legitimate
      // ask, so a second must not cancel the first.
      .pipe(this.shell.withLoading('subtle'), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (copy) =>
          this.toaster.show(this.transloco.translate('compendium.adopted', { name: copy.name }), 'success'),
        error: () => this.toaster.show(this.transloco.translate('compendium.adoptError'), 'error'),
      });
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
      queryParams: { q: null, type: null, tag: null, container: null, field: null },
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
        // after another Container is mounted.
        container: facets.container.length ? [...facets.container] : null,
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
    this.listError.set(false);
    // Nothing mounted: an empty scope would read every Entity the caller can reach, so answer it here
    // — the empty Library a World that Mounts nothing has (ADR-0080).
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
            this.listError.set(true);
          }
        },
      });
    this.fetchFacetCounts(containerId, params);
  }

  /**
   * Every mounted Container, in the Owner's Mount order — the Containers this read names explicitly.
   * The order is not cosmetic: the server reads it back to order the Container facet, which is how the
   * rail reads in the order the Owner arranged (ADR-0080).
   */
  private containerScope(): string[] {
    return this.mounts().map((mount) => mount.containerId);
  }

  private activeFilterParams(): EntityFacetParams {
    const q = this.query();
    const f = this.activeFacets();
    const field = fieldTokens(f.fields);
    return {
      ...(q ? { q } : {}),
      ...(f.type.length ? { type: [...f.type] as EntityType[] } : {}),
      ...(f.tag.length ? { tag: [...f.tag] } : {}),
      ...(f.container.length ? { container: [...f.container] } : {}),
      ...(field.length ? { field } : {}),
    };
  }

  /** Facet counts over the same scope; Visibility is stripped — see {@link facetCounts}. */
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
        error: () => this.toaster.show(this.transloco.translate('library.loadMoreError'), 'error'),
      });
  }
}
