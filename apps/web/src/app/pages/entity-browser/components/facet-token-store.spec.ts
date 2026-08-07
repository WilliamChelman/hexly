import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, ParamMap, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { provideTranslocoTesting } from '../../../../testing/transloco-testing';
import { FACET_CATEGORIES, FacetTokenStore } from './facet-token-store';

/** The Entity Browser's shape: the universal trio, no Container. */
@Component({
  selector: 'app-test-trio-host',
  template: '',
  providers: [{ provide: FACET_CATEGORIES, useValue: ['type', 'tag', 'visibility'] }],
  hostDirectives: [FacetTokenStore],
})
class TrioHost {
  readonly filters = inject(FacetTokenStore);
}

/** The Library's shape: the Container in, Visibility out. */
@Component({
  selector: 'app-test-library-host',
  template: '',
  providers: [{ provide: FACET_CATEGORIES, useValue: ['type', 'tag', 'container'] }],
  hostDirectives: [FacetTokenStore],
})
class LibraryHost {
  readonly filters = inject(FacetTokenStore);
}

/**
 * The two-store wiring the three browse surfaces share (ADR-0082) — filter state is
 * `parse(text) ∪ railState`, the text wins a value both name, and the one rail→text write is a
 * deletion. Each surface's own spec asserts this through its rail; these are the rules themselves,
 * and what its {@link FACET_CATEGORIES} decide.
 */
describe('FacetTokenStore', () => {
  let queryParams$: BehaviorSubject<ParamMap>;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    queryParams$ = new BehaviorSubject<ParamMap>(convertToParamMap({}));
    await TestBed.configureTestingModule({
      imports: [TrioHost, LibraryHost, provideTranslocoTesting()],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { queryParamMap: queryParams$.asObservable() } },
      ],
    }).compileComponents();
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });

  /** Type into the box and flush the 150ms debounce. */
  function type(store: FacetTokenStore, raw: string): void {
    vi.useFakeTimers();
    store.onSearch(raw);
    vi.advanceTimersByTime(150);
    vi.useRealTimers();
  }

  const trio = () => TestBed.createComponent(TrioHost).componentInstance.filters;
  const library = () => TestBed.createComponent(LibraryHost).componentInstance.filters;

  it('keeps the raw string the box holds apart from the residual the wire carries', () => {
    const store = trio();

    type(store, 'orc $tag:fantasy');

    // The box (and the URL's `q`) hold what was typed; the wire's `q` is what is left after the token.
    expect(store.rawQuery()).toBe('orc $tag:fantasy');
    expect(store.searchText()).toBe('orc');
    expect(store.filterParams()).toEqual({ q: 'orc', tag: ['fantasy'] });
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { q: 'orc $tag:fantasy' } }));
  });

  it('unions both stores, and lets the text win a value the rail also names', () => {
    queryParams$.next(convertToParamMap({ type: 'core.type.note', excludeTag: 'draft' }));
    const store = trio();

    type(store, '$tag:draft');

    // The clicked Type stands; the rail's exclusion of `draft` is dropped, the text naming it included.
    expect(store.activeFacets().type).toEqual(['core.type.note']);
    expect(store.activeFacets().tag).toEqual(['draft']);
    expect(store.activeFacets().excluded?.tag).toEqual([]);
    expect(store.queryOwned().categories?.tag).toEqual(['draft']);
  });

  it('deletes exactly the clicked token from the box, leaving the rail store alone', () => {
    queryParams$.next(convertToParamMap({ tag: 'draft' }));
    const store = trio();
    type(store, 'orc $tag:draft $tag:fantasy');

    store.toggleFacet({ category: 'tag', value: 'draft', polarity: 'include' });

    // The other token and the free text stay; the rail's own `draft` was only masked, and is back in force.
    expect(store.rawQuery()).toBe('orc $tag:fantasy');
    expect(store.filterParams()).toEqual({ q: 'orc', tag: ['fantasy', 'draft'] });
    expect(store.queryOwned().categories?.tag).toEqual(['fantasy']);
  });

  it('toggles a rail value against the rail store alone, never writing text', () => {
    const store = trio();
    type(store, '$tag:fantasy');

    store.toggleFacet({ category: 'type', value: 'core.type.note', polarity: 'exclude' });

    expect(store.rawQuery()).toBe('$tag:fantasy');
    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({
        queryParams: {
          type: null,
          tag: null,
          visibility: null,
          field: null,
          excludeType: ['core.type.note'],
          excludeTag: null,
          excludeVisibility: null,
        },
      }),
    );
  });

  /** The categories are the one thing the three surfaces differ in — everything else follows from them. */
  it('offers only its own categories’ names, reporting the rest as a miss', () => {
    const store = trio();

    type(store, '$in:pack-1 $visibility:private');

    expect(store.facetKeys().reserved).toEqual(['type', 'tag', 'visibility']);
    expect(store.unknownFacetKeys()).toEqual(['in']);
    expect(store.filterParams()).toEqual({ visibility: ['private'] });
  });

  it('takes the Container as `$in:` where the surface carries it', () => {
    const store = library();

    type(store, '$in:pack-1 $visibility:private');

    expect(store.facetKeys().reserved).toEqual(['type', 'tag', 'in']);
    expect(store.unknownFacetKeys()).toEqual(['visibility']);
    expect(store.filterParams()).toEqual({ container: ['pack-1'] });
  });

  it('reads and clears only its own categories’ URL params', () => {
    queryParams$.next(convertToParamMap({ q: 'orc', container: 'pack-1', visibility: 'private' }));
    const store = library();

    expect(store.filterParams()).toEqual({ q: 'orc', container: ['pack-1'] });

    store.clearAll();
    expect(store.rawQuery()).toBe('');
    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({
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
      }),
    );
  });

  /** Or every toggle costs a second fetch when its own navigate round-trips back through the URL. */
  it('reads the URL echo of its own state as no change at all', () => {
    const store = trio();
    const before = store.activeFacets();

    store.toggleFacet({ category: 'tag', value: 'draft', polarity: 'include' });
    const toggled = store.activeFacets();
    queryParams$.next(convertToParamMap({ tag: 'draft' }));

    expect(toggled).not.toBe(before);
    expect(store.activeFacets()).toBe(toggled);
  });
});
