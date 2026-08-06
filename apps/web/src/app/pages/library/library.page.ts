import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, Subscription, debounceTime, distinctUntilChanged, finalize, map } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  EntityFacets,
  EntitySummary,
  EntityType,
  FacetKeySet,
  FacetTokenTarget,
  FieldFilter,
  Mount,
  parseFacetQuery,
  removeFacetToken,
} from '@hexly/domain';
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
  // The excluding half (ADR-0081). **Container** included, and only here: this is the one browse whose
  // read spans many Containers, so "everything this World Mounts except that pack" is sayable.
  excluded: { type: [], tag: [], container: [] },
};
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
      <!-- The Entity Browser's own search box, verbatim — the Asset Browser's precedent. The whole
           vocabulary on the dollar (ADR-0082), the Container among it: this is the one browse whose read
           spans many Containers, so a Mounted one is nameable inline as well as clickable. -->
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
  /** The client registry a Facet Token's key resolves against, synchronously (ADR-0082). */
  private readonly types = inject(TypeRegistry);

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

  /**
   * The **text store** (ADR-0082): the box exactly as it was typed, debounced and never rewritten here.
   * Source of truth for the URL `q` mirror, which carries this *raw* string; the wire carries
   * {@link searchText}, the residual after every token is lifted out.
   */
  protected readonly rawQuery = signal('');
  private readonly typed = new Subject<string>();

  /**
   * This surface's Facet vocabulary, from the client registry, synchronously — `in` included, and only
   * here: the Library's read spans every Mounted **Container**, so `$in:` has something to narrow. No
   * `visibility`, which this browse strips from its rail for the reason {@link facetCounts} gives, so a
   * `$visibility:` token is reported as a miss rather than filtering by a word that is false of this
   * list. One set, read thrice: the parser resolves against it, the box offers it on `$`, and a rail
   * click finds the token it deletes by it.
   */
  protected readonly facetKeys = computed<FacetKeySet>(() => ({
    reserved: ['type', 'tag', 'in'],
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
   * the fetch effect. */
  private readonly railFacets = signal<ActiveFacets>(NO_FACETS, {
    equal: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });

  /** The one filter state, `parse(text) ∪ railState` — what the rail renders and the wire carries. The
   * same value-equality: a text edit that leaves the filters alone must not refetch on their account. */
  protected readonly activeFacets = computed(() => unionFacets(this.parsedQuery(), this.railFacets()), {
    equal: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });
  /**
   * The rail counts with Visibility stripped. Visibility is the *owning* Container's business, and
   * nothing here can act on it: a pack's entries are stored `private` yet read by every signed-in
   * caller, so the category would annotate this list with a word that is false of it (ADR-0079).
   */
  protected readonly facetCounts = signal<EntityFacets>(NO_FACET_COUNTS);
  /** Both polarities count as a filter (ADR-0081), so Clear all is offered — and clears — either. */
  protected readonly hasFilters = computed(() => {
    const f = this.activeFacets();
    return (
      this.hasQuery() ||
      f.type.length > 0 ||
      f.tag.length > 0 ||
      f.container.length > 0 ||
      Object.keys(f.fields).length > 0 ||
      Object.values(f.excluded ?? {}).some((values) => (values?.length ?? 0) > 0)
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
          // The exclusions ride the URL like their positive twins (ADR-0081), Container among them, so a
          // narrowed browse survives a refresh and shares as a link.
          excludeType: params.getAll('excludeType'),
          excludeTag: params.getAll('excludeTag'),
          excludeContainer: params.getAll('excludeContainer'),
        })),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        takeUntilDestroyed(),
      )
      .subscribe((f) => {
        this.rawQuery.set(f.q);
        this.railFacets.set({
          type: f.type,
          tag: f.tag,
          // Inert here: see {@link facetCounts} — the category is stripped from the counts.
          visibility: [],
          // This rail carries the exclude control, so a `neq` token is honoured rather than dropped.
          fields: fieldsFromTokens(f.field, true),
          container: f.container,
          excluded: {
            type: f.excludeType,
            tag: f.excludeTag,
            container: f.excludeContainer,
          },
        });
      });

    this.typed.pipe(debounceTime(SEARCH_DEBOUNCE_MS), takeUntilDestroyed()).subscribe((raw) => {
      // Kept verbatim, untrimmed: a trailing space is inside a `$tag:"sea of ` still being typed, and
      // the box must go on holding exactly what was typed (ADR-0082). The parser trims the residual.
      this.setQuery(raw);
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
      this.searchText(); // tracked
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
      queryParams: {
        q: null,
        type: null,
        tag: null,
        container: null,
        field: null,
        excludeType: null,
        excludeTag: null,
        excludeContainer: null,
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
        // Only the *selection* rides the URL, never the scope: a shared link is meant to keep meaning
        // after another Container is mounted. Which holds of an exclusion too — it names a Container to
        // leave out of the Mount set, not a smaller Mount set.
        container: facets.container.length ? [...facets.container] : null,
        field: field.length ? field : null,
        excludeType: excluded.type?.length ? [...excluded.type] : null,
        excludeTag: excluded.tag?.length ? [...excluded.tag] : null,
        excludeContainer: excluded.container?.length ? [...excluded.container] : null,
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
    // The residual text, not the raw box: the tokens have become params by here (ADR-0082).
    const q = this.searchText();
    const f = this.activeFacets();
    const excluded = f.excluded ?? {};
    const field = fieldTokens(f.fields);
    return {
      ...(q ? { q } : {}),
      ...(f.type.length ? { type: [...f.type] as EntityType[] } : {}),
      ...(f.tag.length ? { tag: [...f.tag] } : {}),
      ...(f.container.length ? { container: [...f.container] } : {}),
      ...(field.length ? { field } : {}),
      // The excluding half, sent on the list and the Facet read alike (ADR-0081). `excludeContainer`
      // narrows *within* the scope like its positive twin: `containerId` still names every Mount.
      ...(excluded.type?.length ? { excludeType: [...excluded.type] as EntityType[] } : {}),
      ...(excluded.tag?.length ? { excludeTag: [...excluded.tag] } : {}),
      ...(excluded.container?.length ? { excludeContainer: [...excluded.container] } : {}),
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
