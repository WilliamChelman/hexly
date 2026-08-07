import { Directive, InjectionToken, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged, map } from 'rxjs';
import { FacetKeySet, FacetTokenTarget, FieldFilter, parseFacetQuery, removeFacetToken } from '@hexly/domain';
import { EntityFacetParams } from '@hexly/web-core';
import {
  ActiveFacets,
  FacetCategory,
  FacetToggle,
  FieldRangeBound,
  FieldRangeChange,
  FieldSelection,
  FieldValueToggle,
  togglePolarity,
} from './facet-rail.component';
import { boundOf, fieldTokens, fieldsFromTokens, pruneField } from './field-facet-url';
import { queryOwnedFacets, unionFacets } from './facet-token-union';
import { TypeRegistry } from '../../../entity-types/type-registry';

/**
 * The Facet categories one browse surface can narrow by — the Entity Browser's universal trio, the
 * Library's Containers, the Asset Browser's pair with its pinned Type left out. It is the one thing
 * the three surfaces genuinely differ in, so {@link FacetTokenStore} takes it and derives the rest:
 * the URL params it round-trips, what Clear all clears, and which reserved names the box offers on `$`
 * — a category this surface cannot narrow is a **stated miss**, never a silent filter (ADR-0082).
 */
export const FACET_CATEGORIES = new InjectionToken<readonly FacetCategory[]>('FACET_CATEGORIES');

/** The reserved name each category is typed by: the Container reads as a place (ADR-0082). */
const TOKEN_NAME: Readonly<Record<FacetCategory, string>> = {
  type: 'type',
  tag: 'tag',
  visibility: 'visibility',
  container: 'in',
};

/** Each category's excluding half on the URL and the wire (ADR-0081). */
const EXCLUDE_PARAM: Readonly<Record<FacetCategory, string>> = {
  type: 'excludeType',
  tag: 'excludeTag',
  visibility: 'excludeVisibility',
  container: 'excludeContainer',
};

/** Value equality for the two facet signals: a fresh object with the same values is not a change. */
const sameValue = (a: ActiveFacets, b: ActiveFacets) => JSON.stringify(a) === JSON.stringify(b);

/** Same 150ms the shared searchEntities helper uses for autocomplete. */
const SEARCH_DEBOUNCE_MS = 150;

/**
 * The **two stores** a browse surface filters by (ADR-0082), as a host directive: the **text store**
 * — the search box, parsed live — and the **rail store** — what was clicked. Filter state is
 * `parse(text) ∪ railState`, and where both name the same value the text wins and the rail's entry is
 * dropped, so a contradiction resolves visibly at the moment of typing.
 *
 * Neither store writes into the other except to delete: {@link toggleFacet} on a row the text owns
 * takes *that* token out of the box ({@link removeFacetToken}) and leaves the rail alone, which is the
 * design's one rail→text write. Both stores mirror to the URL — the text to `q`, the rail to the
 * category params — so a browse survives a refresh and shares as a link.
 *
 * A page supplies its {@link FACET_CATEGORIES} and reads the result; everything else here is the same
 * on all three surfaces.
 */
@Directive({})
export class FacetTokenStore {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  /** The client registry a Facet Token's key resolves against, synchronously (ADR-0082). */
  private readonly types = inject(TypeRegistry);
  private readonly categories = inject(FACET_CATEGORIES);

  /** The params both stores round-trip, in the order they are written to the URL. */
  private readonly urlParams = [
    ...this.categories,
    'field',
    ...this.categories.map((category) => EXCLUDE_PARAM[category]),
  ];

  /**
   * The **text store**: the box exactly as it was typed, debounced and never rewritten here. Source of
   * truth for the URL `q` mirror, which carries this *raw* string; the wire carries {@link searchText},
   * the residual after every token is lifted out.
   */
  private readonly _rawQuery = signal('');
  readonly rawQuery = this._rawQuery.asReadonly();
  private readonly typed = new Subject<string>();

  /**
   * This surface's Facet vocabulary, from the client registry, synchronously — the reserved names of
   * the categories it can narrow, plus every Facet key. The registry is the *only* source, the Facet
   * read never widening it: a parser that changes its mind when a network read lands rewrites results
   * while they are being read (ADR-0082). One set, read thrice: the parser resolves against it, the box
   * offers it on `$`, and a rail click finds the token it deletes by it.
   */
  readonly facetKeys = computed<FacetKeySet>(() => ({
    reserved: this.categories.map((category) => TOKEN_NAME[category]),
    fields: this.types.facetKeys(),
  }));
  /** What the box means: its **Facet Tokens** as structured filters and the free text left over. */
  readonly parsedQuery = computed(() => parseFacetQuery(this.rawQuery(), this.facetKeys()));
  /** Which rail rows the text owns, so they render as query-owned and click off as a token (ADR-0082). */
  readonly queryOwned = computed(() => queryOwnedFacets(this.parsedQuery()));
  /** The residual full-text query — what the wire's `q` carries, as against the URL's raw string. */
  readonly searchText = computed(() => this.parsedQuery().text);
  /** The `$` names nothing here answers to, for the surface to report (ADR-0082). */
  readonly unknownFacetKeys = computed(() => this.parsedQuery().unresolvedKeys);
  /** Whether the box holds anything at all to search or filter by — blanks are not a query. */
  readonly hasQuery = computed(() => this.rawQuery().trim() !== '');

  /** The **rail store**: what was clicked. Value-equal so the URL round-trip's echo (a fresh object,
   * same values) doesn't re-trigger the caller's fetch — one refetch per toggle. */
  private readonly railFacets = signal<ActiveFacets>(this.railStateFrom({}), { equal: sameValue });

  /** The one filter state, `parse(text) ∪ railState` — what the rail renders and the wire carries. The
   * same value-equality: a text edit that leaves the filters alone must not refetch on their account. */
  readonly activeFacets = computed(() => unionFacets(this.parsedQuery(), this.railFacets()), { equal: sameValue });

  /** Both polarities count as a filter (ADR-0081), so Clear all is offered — and clears — either. */
  readonly hasFilters = computed(() => {
    const facets = this.activeFacets();
    return (
      this.hasQuery() ||
      this.categories.some((category) => facets[category].length > 0) ||
      Object.keys(facets.fields).length > 0 ||
      Object.values(facets.excluded ?? {}).some((values) => (values?.length ?? 0) > 0)
    );
  });

  /**
   * Both stores as the list/Facet-read params they name, for a surface to spread its own scope and pins
   * over. The residual text, not the raw box: the tokens have become params by here (ADR-0082).
   */
  readonly filterParams = computed<EntityFacetParams>(() => {
    const q = this.searchText();
    const facets = this.activeFacets();
    const excluded = facets.excluded ?? {};
    const field = fieldTokens(facets.fields);
    // Each category is spelled the same on the wire as in the rail, so the params are built by name.
    const params: Record<string, unknown> = q ? { q } : {};
    for (const category of this.categories) if (facets[category].length) params[category] = [...facets[category]];
    if (field.length) params['field'] = field;
    for (const category of this.categories) {
      const values = excluded[category] ?? [];
      if (values.length) params[EXCLUDE_PARAM[category]] = [...values];
    }
    return params as EntityFacetParams;
  });

  constructor() {
    // Seed both stores from the URL and follow back/forward. Subscribed in the host directive's
    // constructor, so the synchronous first emission lands before the page's fetch effect exists — one
    // request on load. The distinctUntilChanged absorbs the echo when a toggle's own navigate
    // round-trips back, so there's no read/write loop.
    this.route.queryParamMap
      .pipe(
        map((params) => ({
          q: params.get('q') ?? '',
          rail: Object.fromEntries(this.urlParams.map((name) => [name, params.getAll(name)])),
        })),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        takeUntilDestroyed(),
      )
      .subscribe(({ q, rail }) => {
        this._rawQuery.set(q);
        this.railFacets.set(this.railStateFrom(rail));
      });

    this.typed.pipe(debounceTime(SEARCH_DEBOUNCE_MS), takeUntilDestroyed()).subscribe((raw) => {
      // Kept verbatim, untrimmed: a trailing space is inside a `$tag:"sea of ` still being typed, and
      // the box must go on holding exactly what was typed (ADR-0082). The parser trims the residual.
      this.setQuery(raw);
    });
  }

  /** One keystroke's worth of box, debounced into the text store. */
  onSearch(value: string): void {
    this.typed.next(value);
  }

  /** Toggle one category value in the polarity the pressed control names; the other is released.
   * Against the rail store alone — a clicked Facet lives in the rail, and never writes text (ADR-0082). */
  toggleFacet({ category, value, polarity }: FacetToggle): void {
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
  toggleFieldValue({ key, value, polarity }: FieldValueToggle): void {
    if (this.fieldNamedInText(key, (f) => (f.op === 'eq' || f.op === 'neq') && f.value === value))
      return this.dropToken({ field: key, value });
    const current = this.railFacets();
    const sel = current.fields[key] ?? {};
    const next = togglePolarity(sel.values ?? [], sel.excluded ?? [], value, polarity);
    this.setFieldSelection(current, key, { ...sel, values: next.included, excluded: next.excluded });
  }

  /** Set (or clear) one bound of a number/date Field range. A bound the text named is reversed where it
   * was named (ADR-0082): its input renders query-owned and readonly, so the change that reaches here is
   * its delete control, and it takes that token out of the box rather than refusing an edit in silence. */
  changeFieldRange({ key, bound, value }: FieldRangeChange): void {
    const named = this.boundNamedInText(key, bound);
    if (named) return this.dropToken({ field: key, op: named.op, value: named.value });
    const current = this.railFacets();
    const sel = current.fields[key] ?? {};
    this.setFieldSelection(current, key, { ...sel, [bound]: value || undefined });
  }

  /** Clears both stores — a typed Facet is as cleared as a clicked one, and the box empties with it. */
  clearAll(): void {
    this._rawQuery.set('');
    this.railFacets.set(this.railStateFrom({}));
    this.router.navigate([], {
      relativeTo: this.route,
      // Clear all clears both polarities (ADR-0081).
      queryParams: { q: null, ...Object.fromEntries(this.urlParams.map((name) => [name, null])) },
      queryParamsHandling: 'merge',
      replaceUrl: true,
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
    this._rawQuery.set(raw);
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

  /** The same rule for a Facet key's value rows. */
  private fieldNamedInText(key: string, matches: (filter: FieldFilter) => boolean): boolean {
    return this.parsedQuery().fields.some((f) => f.key === key && matches(f));
  }

  /** The token filter standing in one of a range row's two inputs, if the text named it — the last of
   * them, since the fold that renders the input lets the last win too. */
  private boundNamedInText(key: string, bound: FieldRangeBound): FieldFilter | undefined {
    let named: FieldFilter | undefined;
    for (const filter of this.parsedQuery().fields)
      if (filter.key === key && boundOf(filter.op) === bound) named = filter;
    return named;
  }

  /** Fold a Field selection back into the rail store, pruning it away once empty. */
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
    const excluded = updated.excluded ?? {};
    const field = fieldTokens(updated.fields);
    const queryParams: Record<string, readonly string[] | null> = {};
    for (const category of this.categories)
      queryParams[category] = updated[category].length ? [...updated[category]] : null;
    queryParams['field'] = field.length ? field : null;
    for (const category of this.categories) {
      const values = excluded[category] ?? [];
      queryParams[EXCLUDE_PARAM[category]] = values.length ? [...values] : null;
    }
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /**
   * One rail store out of the URL's params — and, read empty, the cleared one. Both spellings come from
   * here because the signal compares by JSON: a differently-ordered twin of the same state would read
   * as a change and cost a second fetch on every URL echo.
   */
  private railStateFrom(rail: Readonly<Record<string, readonly string[]>>): ActiveFacets {
    const values = (name: string) => rail[name] ?? [];
    return {
      type: values('type'),
      tag: values('tag'),
      visibility: values('visibility'),
      container: values('container'),
      fields: fieldsFromTokens(values('field')),
      excluded: Object.fromEntries(this.categories.map((category) => [category, values(EXCLUDE_PARAM[category])])),
    };
  }
}
