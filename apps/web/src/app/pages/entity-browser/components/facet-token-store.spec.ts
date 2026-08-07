import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, ParamMap, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { Field } from '@hexly/domain';
import { ClientConfigStore } from '@hexly/web-core';
import { mockClientConfigStore } from '@hexly/web-core/testing';
import { provideTranslocoTesting } from '../../../../testing/transloco-testing';
import { TypeRegistry } from '../../../entity-types/type-registry';
import { FACET_CATEGORIES, FacetTokenStore } from './facet-token-store';

/** This build's one Facet key, as the World's Fields project it (ADR-0054): `$cr:` resolves, and
 * anything else this surface's reserved names do not carry is a stated miss. */
const CR_FIELD: Field = {
  id: 'cr',
  label: 'CR',
  dataType: { kind: 'number' },
  required: false,
  facetable: true,
};

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
  let registry: TypeRegistry;

  beforeEach(async () => {
    queryParams$ = new BehaviorSubject<ParamMap>(convertToParamMap({}));
    await TestBed.configureTestingModule({
      imports: [TrioHost, LibraryHost, provideTranslocoTesting()],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { queryParamMap: queryParams$.asObservable() } },
        { provide: ClientConfigStore, useValue: mockClientConfigStore() },
      ],
    }).compileComponents();
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    // The client registry the box's Facet keys come from, synchronously (ADR-0082), with the World's
    // Fields already landed — the cold-load case is its own describe below.
    registry = TestBed.inject(TypeRegistry);
    registry.setWorldFields([CR_FIELD]);
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
    expect(store.parsedQuery().unresolvedKeys).toEqual(['in']);
    expect(store.filterParams()).toEqual({ visibility: ['private'] });
  });

  it('takes the Container as `$in:` where the surface carries it', () => {
    const store = library();

    type(store, '$in:pack-1 $visibility:private');

    expect(store.facetKeys().reserved).toEqual(['type', 'tag', 'in']);
    expect(store.parsedQuery().unresolvedKeys).toEqual(['visibility']);
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

  /**
   * A range **bound** the text names (ADR-0082, #430). It used to be refused — the rail rendered the
   * typed bound as an editable input, the handler returned, and the input then showed a number the wire
   * never carried. The bound is now query-owned per bound, and reversed by deleting its own token.
   */
  describe('a bound the text names', () => {
    it('marks the named bound query-owned, and only that one', () => {
      const store = trio();

      type(store, '$cr:>=5');

      expect(store.queryOwned().bounds).toEqual({ cr: ['gte'] });
      expect(store.activeFacets().fields).toEqual({ cr: { values: [], gte: { value: '5', op: 'gte' } } });
    });

    /** The input a bound renders in is a rendering question; whether the boundary row is in is not. */
    it('carries a strictly-written bound to the wire strict, in the input its inclusive twin fills', () => {
      const store = trio();

      type(store, '$cr:>5');

      expect(store.queryOwned().bounds).toEqual({ cr: ['gte'] });
      expect(store.filterParams()).toEqual({ field: ['cr:gt:5'] });
    });

    it('sets the rail’s own bound inclusive, the row having no control for a strict one', () => {
      const store = trio();

      store.changeFieldRange({ key: 'cr', bound: 'gte', value: '5' });

      expect(store.filterParams()).toEqual({ field: ['cr:gte:5'] });
    });

    it('deletes exactly that token when its bound is cleared, leaving the rest of the box', () => {
      const store = trio();
      type(store, 'orc $cr:>=5 $tag:draft');

      store.changeFieldRange({ key: 'cr', bound: 'gte', value: '' });

      expect(store.rawQuery()).toBe('orc $tag:draft');
      expect(store.queryOwned().bounds).toEqual({});
      expect(store.filterParams()).toEqual({ q: 'orc', tag: ['draft'] });
    });

    it('takes a strictly-written bound out by what was typed, not by the input it stands in', () => {
      const store = trio();
      type(store, '$cr:>5');

      expect(store.queryOwned().bounds).toEqual({ cr: ['gte'] });
      store.changeFieldRange({ key: 'cr', bound: 'gte', value: '' });

      expect(store.rawQuery()).toBe('');
    });

    it('leaves the same Field’s other bound the rail’s to set, and the box untouched', () => {
      const store = trio();
      type(store, '$cr:>=5');

      store.changeFieldRange({ key: 'cr', bound: 'lte', value: '9' });

      // One Field, two owners: the text's minimum and the rail's maximum, both in force.
      expect(store.rawQuery()).toBe('$cr:>=5');
      expect(store.queryOwned().bounds).toEqual({ cr: ['gte'] });
      expect(store.activeFacets().fields).toEqual({
        cr: { values: [], gte: { value: '5', op: 'gte' }, lte: { value: '9', op: 'lte' } },
      });
      expect(store.filterParams()).toEqual({ field: ['cr:gte:5', 'cr:lte:9'] });
    });

    it('leaves a Field value the text names deletable as before, bounds or no bounds', () => {
      const store = trio();
      type(store, '$cr:>=5 $cr:7');

      store.toggleFieldValue({ key: 'cr', value: '7', polarity: 'include' });

      expect(store.rawQuery()).toBe('$cr:>=5');
    });
  });

  /**
   * A cold load, the World's Fields still in flight (ADR-0082). The key set is read from the registry
   * synchronously *and a late response may never change what a filter means* — so a `$key` the registry
   * cannot answer for **yet** is unresolved, not unresolvable. It used to be reported as a miss and
   * browsed as though it were never typed: a shared link showed the whole World, the banner said the key
   * did not exist, and both corrected themselves when the Fields response landed.
   */
  describe('a key the registry cannot answer for yet', () => {
    /** Entering a World: the loader has asked for its Fields and nothing has answered, so the registry
     * holds none — the outer projection is what *lands*, mid-test, below. */
    beforeEach(() => {
      registry.setWorldFields([]);
      registry.awaitWorldFields();
    });

    it('holds the read rather than browsing unfiltered, and states no miss', () => {
      queryParams$.next(convertToParamMap({ q: '$cr:5' }));
      const store = trio();

      expect(store.filtersPending()).toBe(true);
      expect(store.parsedQuery().unresolvedKeys).toEqual([]);
      // What is held back, and why: read now, these params name no Field — every Entity in the World.
      expect(store.filterParams()).toEqual({});
    });

    it('filters by the key the Fields response names, on the first read the surface makes', () => {
      queryParams$.next(convertToParamMap({ q: '$cr:5' }));
      const store = trio();

      registry.setWorldFields([CR_FIELD]);

      expect(store.filtersPending()).toBe(false);
      expect(store.filterParams()).toEqual({ field: ['cr:eq:5'] });
    });

    it('states the miss once the Fields answered without the key', () => {
      queryParams$.next(convertToParamMap({ q: 'orc $domain:material' }));
      const store = trio();

      registry.setWorldFields([CR_FIELD]);

      expect(store.filtersPending()).toBe(false);
      expect(store.parsedQuery().unresolvedKeys).toEqual(['domain']);
      expect(store.filterParams()).toEqual({ q: 'orc' });
    });

    it('never waits on the Fields read for a name the reserved set decides', () => {
      queryParams$.next(convertToParamMap({ q: '$type:core.type.note $in:pack-1' }));
      const store = trio();

      // `$type` resolves from the reserved names, and `$in` is a miss this surface can state at once —
      // no Fields response can make a World-scoped browse able to narrow by Container.
      expect(store.filtersPending()).toBe(false);
      expect(store.filterParams()).toEqual({ type: ['core.type.note'] });
      expect(store.parsedQuery().unresolvedKeys).toEqual(['in']);
    });
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
