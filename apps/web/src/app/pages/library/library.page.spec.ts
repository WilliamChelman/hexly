import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, ParamMap, provideRouter, Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { EntitySummary, Mount } from '@hexly/domain';
import { ActiveWorld, EntitiesClient, WorldsClient } from '@hexly/web-core';
import { MockEntitiesClient, MockWorldsClient } from '@hexly/web-core/testing';
import { providePluginContent } from '@hexly/plugin-content/web';
import { provideTranslocoTesting } from '../../../testing/transloco-testing';
import { LibraryPage } from './library.page';
import { TypeRegistry } from '../../entity-types/type-registry';

/**
 * The **Library** (#412, ADR-0080): the Entity Browser preset to what this World **Mounts**. What is
 * this page's own — rather than the Entity Browser's, already pinned in its spec — is where the scope
 * comes from: the Mount set, in the Owner's order, and the three ways it can be absent — a World that
 * mounts nothing, a read that failed, and a reader with no standing to be told.
 */
describe('Library', () => {
  let entities: MockEntitiesClient;
  let worlds: MockWorldsClient;
  let queryParams$: BehaviorSubject<ParamMap>;

  /** An installed pack and a mounted Shelf — the two kinds of Container a Mount names (ADR-0080). */
  const pack: Mount = { containerId: 'c-pack', name: 'Draw Steel: Monsters', kind: 'compendium' };
  const shelf: Mount = { containerId: 'c-shelf', name: 'The Art Shelf', kind: 'world' };

  const summary = (over: Partial<EntitySummary>): EntitySummary => ({
    id: 'e1',
    worldId: 'c-pack',
    name: 'Goblin Warrior',
    types: ['core.type.note'],
    tags: [],
    visibility: 'private',
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    // A Compendium Entry's Rights are `read` alone, and `sealed` is what offers Adoption (ADR-0079).
    rights: ['read'],
    sealed: true,
    ...over,
  });

  beforeEach(async () => {
    entities = new MockEntitiesClient();
    worlds = new MockWorldsClient();
    queryParams$ = new BehaviorSubject<ParamMap>(convertToParamMap({}));
    await TestBed.configureTestingModule({
      imports: [LibraryPage, provideTranslocoTesting()],
      providers: [
        providePluginContent(),
        { provide: EntitiesClient, useValue: entities },
        { provide: WorldsClient, useValue: worlds },
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { queryParamMap: queryParams$.asObservable() } },
      ],
    }).compileComponents();
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    TestBed.inject(ActiveWorld).set('w1');
  });

  /** Mount `mounts`, resolve the first page with `items`, and return the mounted fixture. */
  function renderWith(mounts: Mount[], items: EntitySummary[] = []) {
    worlds.mounts.mockReturnValue(of(mounts));
    entities.list.mockReturnValue(of({ items, nextCursor: null }));
    const fixture = TestBed.createComponent(LibraryPage);
    fixture.detectChanges(); // active-World effect -> mounts() -> list()
    fixture.detectChanges();
    return fixture;
  }

  it('scopes the list to every mounted Container, in the Owner’s Mount order', () => {
    renderWith([pack, shelf], [summary({})]);

    // The order is not cosmetic: the server reads it back to order the Container facet, which is how
    // the rail reads in the order the Owner arranged (ADR-0080).
    // The whole read, spelled out: the Containers are the only scope on the wire. The World in the URL
    // names whose Mounts these are and the Adoption target, and rides nothing — a Mount widens what a
    // World may point at, never what it holds.
    expect(entities.list).toHaveBeenCalledWith({
      limit: 50,
      containerId: ['c-pack', 'c-shelf'],
      rights: true,
      thumbnails: true,
    });
    expect(entities.facets).toHaveBeenCalledWith({ containerId: ['c-pack', 'c-shelf'] });
  });

  it('shows a World that Mounts nothing an empty Library that says so, and reads nothing', () => {
    const el = renderWith([]).nativeElement as HTMLElement;

    // A read naming no Container is an unscoped read of every Entity the caller can reach — not an
    // empty one — so the empty Mount set is answered here rather than on the wire.
    expect(entities.list).not.toHaveBeenCalled();
    const empty = el.querySelector('[data-testid=no-mounts]');
    expect(empty?.textContent).toContain('This world draws on nothing yet.');
    // Which emptiness this is, told apart from "nothing matched" and "nothing to show".
    expect(el.querySelector('[data-testid=empty]')).toBeNull();
    expect(el.querySelector('[data-testid=no-matches]')).toBeNull();
  });

  it('still says it draws on nothing when a search query rides the URL', () => {
    queryParams$.next(convertToParamMap({ q: 'goblin' }));
    const el = renderWith([]).nativeElement as HTMLElement;

    // With nothing mounted there was nothing to search, so "nothing matched your search" would name a
    // failure that never happened (ADR-0080).
    expect(el.querySelector('[data-testid=no-mounts]')).not.toBeNull();
    expect(el.querySelector('[data-testid=no-matches]')).toBeNull();
  });

  it('tells a failed read of the Mount set apart from a World that Mounts nothing', () => {
    worlds.mounts.mockReturnValue(throwError(() => new Error('offline')));
    const fixture = TestBed.createComponent(LibraryPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    // "We could not ask" and "it draws on nothing" are different answers, and telling them apart is
    // what the empty Library is for (#412) — so the failure must not read as the emptiness.
    expect(el.querySelector('[data-testid=load-error]')).not.toBeNull();
    expect(el.querySelector('[data-testid=no-mounts]')).toBeNull();
  });

  it('shows a non-member reader nothing rather than a failure that never happened', () => {
    // The Mount set is member-gated: a reader who reaches this World through someone else's Mount is
    // refused it, because the cascade is one hop and naming these Containers would disclose the second
    // (ADR-0080). Nothing went wrong, so nothing may say so.
    worlds.mounts.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403, statusText: 'Forbidden' })));
    const fixture = TestBed.createComponent(LibraryPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('[data-testid=members-only]')).not.toBeNull();
    expect(el.querySelector('[data-testid=load-error]')).toBeNull();
    // Nor the emptiness of a World that Mounts nothing: this reader was told nothing, which is not the
    // same as being told there is nothing.
    expect(el.querySelector('[data-testid=no-mounts]')).toBeNull();
    // And nothing is read on their behalf: an empty scope would list every Entity they can reach.
    expect(entities.list).not.toHaveBeenCalled();
  });

  it('credits the mounted Compendiums by name, linking each to its own Compendium page', () => {
    const el = renderWith([pack, shelf], [summary({})]).nativeElement as HTMLElement;

    const credits = el.querySelector('[data-testid=library-credits]');
    expect(credits?.textContent).toContain('Draw Steel: Monsters');
    // The **Compendium page** stays where it is, reached from the Library that credits it (ADR-0080).
    expect(el.querySelector('[data-testid=library-credit-c-pack]')?.getAttribute('href')).toContain('/compendium/');
    // A mounted World publishes under no terms and has no such page, so it is credited nowhere.
    expect(credits?.textContent).not.toContain('The Art Shelf');
    expect(el.querySelector('[data-testid=library-credit-c-shelf]')).toBeNull();
  });

  it('offers Adoption where the content is, and no rename or delete beside it', () => {
    const el = renderWith([pack], [summary({})]).nativeElement as HTMLElement;

    // Read-only is inherited, never special-cased: `read` alone is what hides rename and delete, and
    // `sealed` is what offers the copy-it-to-change-it path (ADR-0079, #403).
    expect(el.querySelector('[data-testid=adopt-e1]')).not.toBeNull();
    expect(el.querySelector('[data-testid^=rename-]')).toBeNull();
    expect(el.querySelector('[data-testid^=delete-]')).toBeNull();
  });

  it('seeds the Container facet’s selection from the URL and narrows the read by it', () => {
    worlds.mounts.mockReturnValue(of([pack, shelf]));
    entities.list.mockReturnValue(of({ items: [], nextCursor: null }));
    queryParams$.next(convertToParamMap({ container: 'c-pack' }));
    const fixture = TestBed.createComponent(LibraryPage);
    fixture.detectChanges();

    // The selection narrows *within* the scope rather than redefining it: both ride the wire, and they
    // AND server-side, so a shared link keeps its meaning after another Container is mounted.
    expect(entities.list).toHaveBeenCalledWith(
      expect.objectContaining({ containerId: ['c-pack', 'c-shelf'], container: ['c-pack'] }),
    );
  });

  /**
   * Exclusion reaches the Library (ADR-0081, #423). Its own case rather than the Entity Browser's
   * again: **Container** is a category only this browse has, and "everything this World Mounts except
   * that pack" is the ask the Library exists for.
   */
  describe('Excluding a value (#423)', () => {
    const facet = (el: HTMLElement, testid: string) => el.querySelector<HTMLElement>(`[data-testid="${testid}"]`);

    /** Both Containers counted and on screen, with the next list read stubbed, ready for a toggle. */
    function ready() {
      entities.facets.mockReturnValue(
        of({
          type: [],
          tag: [{ value: 'draft', count: 1 }],
          visibility: [],
          fields: [],
          container: [
            { value: 'c-shelf', count: 1, label: 'The Art Shelf' },
            { value: 'c-pack', count: 2, label: 'Draw Steel: Monsters' },
          ],
        }),
      );
      const fixture = renderWith([shelf, pack], [summary({})]);
      entities.list.mockReturnValue(of({ items: [], nextCursor: null }));
      return { fixture, el: fixture.nativeElement as HTMLElement };
    }

    it('excludes one Mounted Container without narrowing the scope, and mirrors it to the URL', () => {
      const { fixture, el } = ready();

      facet(el, 'facet-exclude-container-c-pack')?.click();
      fixture.detectChanges();

      // The scope is still every Mount — the exclusion narrows *within* it, exactly as its positive
      // twin does, so a shared link keeps meaning after another Container is mounted.
      expect(entities.list).toHaveBeenLastCalledWith({
        limit: 50,
        containerId: ['c-shelf', 'c-pack'],
        rights: true,
        thumbnails: true,
        excludeContainer: ['c-pack'],
      });
      // The counts drill down against the exclusion too, or the rail would annotate a list it disagrees with.
      expect(entities.facets).toHaveBeenLastCalledWith({
        containerId: ['c-shelf', 'c-pack'],
        excludeContainer: ['c-pack'],
      });
      expect(TestBed.inject(Router).navigate).toHaveBeenLastCalledWith(
        [],
        expect.objectContaining({ queryParams: expect.objectContaining({ excludeContainer: ['c-pack'] }) }),
      );
    });

    it('is reversible by clicking the same control', () => {
      const { fixture, el } = ready();

      facet(el, 'facet-exclude-container-c-pack')?.click();
      fixture.detectChanges();
      expect(facet(el, 'facet-exclude-container-c-pack')?.getAttribute('aria-pressed')).toBe('true');

      facet(el, 'facet-exclude-container-c-pack')?.click();
      fixture.detectChanges();

      expect(entities.list).toHaveBeenLastCalledWith({
        limit: 50,
        containerId: ['c-shelf', 'c-pack'],
        rights: true,
        thumbnails: true,
      });
    });

    it('releases the exclusion when include is pressed on the same Container', () => {
      const { fixture, el } = ready();

      facet(el, 'facet-exclude-container-c-pack')?.click();
      fixture.detectChanges();
      facet(el, 'facet-container-c-pack')?.click();
      fixture.detectChanges();

      // Never both: the contradiction stays out of the rail's reach by construction (ADR-0081).
      expect(entities.list).toHaveBeenLastCalledWith({
        limit: 50,
        containerId: ['c-shelf', 'c-pack'],
        rights: true,
        thumbnails: true,
        container: ['c-pack'],
      });
      expect(facet(el, 'facet-exclude-container-c-pack')?.getAttribute('aria-pressed')).toBe('false');
    });

    it('excludes a Tag and a Field value the same way', () => {
      entities.facets.mockReturnValue(
        of({
          type: [],
          tag: [{ value: 'draft', count: 1 }],
          visibility: [],
          fields: [
            {
              key: 'role',
              label: 'Role',
              dataType: { kind: 'enum' as const, options: ['harrier', 'brute'] },
              values: [{ value: 'harrier', count: 1 }],
            },
          ],
        }),
      );
      const fixture = renderWith([pack], [summary({})]);
      const el = fixture.nativeElement as HTMLElement;
      entities.list.mockReturnValue(of({ items: [], nextCursor: null }));

      facet(el, 'facet-exclude-tag-draft')?.click();
      fixture.detectChanges();
      expect(entities.list).toHaveBeenLastCalledWith(expect.objectContaining({ excludeTag: ['draft'] }));

      // A Field's exclusion rides the `field` param's own `neq` op rather than a param of its own.
      facet(el, 'facet-exclude-field-role-harrier')?.click();
      fixture.detectChanges();
      expect(entities.list).toHaveBeenLastCalledWith(expect.objectContaining({ field: ['role:neq:harrier'] }));
    });

    it('seeds exclusions from the URL into the first fetch and lights their controls', () => {
      entities.facets.mockReturnValue(
        of({
          type: [],
          tag: [{ value: 'draft', count: 1 }],
          visibility: [],
          fields: [],
          container: [{ value: 'c-shelf', count: 1, label: 'The Art Shelf' }],
        }),
      );
      worlds.mounts.mockReturnValue(of([shelf, pack]));
      entities.list.mockReturnValue(of({ items: [], nextCursor: null }));
      queryParams$.next(convertToParamMap({ excludeContainer: 'c-pack', excludeTag: 'draft' }));
      const fixture = TestBed.createComponent(LibraryPage);
      fixture.detectChanges();
      fixture.detectChanges();

      expect(entities.list).toHaveBeenCalledWith({
        limit: 50,
        containerId: ['c-shelf', 'c-pack'],
        rights: true,
        thumbnails: true,
        excludeContainer: ['c-pack'],
        excludeTag: ['draft'],
      });
      // One request on load — the seeded browse is the first one, not a correction of an empty one.
      expect(entities.list).toHaveBeenCalledTimes(1);
      const el = fixture.nativeElement as HTMLElement;
      expect(facet(el, 'facet-exclude-tag-draft')?.getAttribute('aria-pressed')).toBe('true');
      // And the excluded Container is listed although the drill-down stopped counting it — or the
      // exclusion would be a one-way door, with no row left to click off.
      expect(facet(el, 'facet-exclude-container-c-pack')?.getAttribute('aria-pressed')).toBe('true');
      expect(facet(el, 'facet-container-c-pack')?.querySelector('span.tabular-nums')?.textContent?.trim()).toBe('0');
    });

    it('offers Clear all for an exclusion alone, and clears both polarities', () => {
      const { fixture, el } = ready();

      facet(el, 'facet-container-c-shelf')?.click();
      fixture.detectChanges();
      facet(el, 'facet-exclude-container-c-pack')?.click();
      fixture.detectChanges();
      expect(facet(el, 'facet-clear')).not.toBeNull();

      facet(el, 'facet-clear')?.click();
      fixture.detectChanges();

      expect(TestBed.inject(Router).navigate).toHaveBeenLastCalledWith(
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
      expect(entities.list).toHaveBeenLastCalledWith({
        limit: 50,
        containerId: ['c-shelf', 'c-pack'],
        rights: true,
        thumbnails: true,
      });
    });
  });

  /**
   * A Facet named inline rather than clicked (ADR-0082, #428). The grammar belongs to the domain
   * parser's spec and the two-store rule to the Entity Browser's; what is this surface's own is its
   * **vocabulary** — `$in:` for a Mounted **Container**, the one browse where the category is real, and
   * no `$visibility:`, which this browse strips from its rail and so reports as a miss.
   */
  describe('Facet Tokens (#428)', () => {
    const facet = (el: HTMLElement, testid: string) => el.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
    const searchBox = (el: HTMLElement) => el.querySelector('[data-testid=entity-search]') as HTMLInputElement;

    /** The list read this page always makes, minus whatever a token adds. */
    const baseRead = { limit: 50, containerId: ['c-shelf', 'c-pack'], rights: true, thumbnails: true };

    /** Both Mounts counted, with a Tag and a Container facet to name — and the next read stubbed. */
    function ready() {
      entities.facets.mockReturnValue(
        of({
          type: [{ value: 'core.type.note', count: 3 }],
          tag: [
            { value: 'draft', count: 2 },
            { value: 'fantasy', count: 1 },
          ],
          visibility: [],
          fields: [],
          container: [
            { value: 'c-shelf', count: 1, label: 'The Art Shelf' },
            { value: 'c-pack', count: 2, label: 'Draw Steel: Monsters' },
          ],
        }),
      );
      const fixture = renderWith([shelf, pack], [summary({})]);
      entities.list.mockReturnValue(of({ items: [], nextCursor: null }));
      return { fixture, el: fixture.nativeElement as HTMLElement };
    }

    /** Put `q` in the box with the caret at its end, as a caller typing it would. */
    function type(fixture: ReturnType<typeof renderWith>, q: string) {
      const box = searchBox(fixture.nativeElement);
      box.value = q;
      box.setSelectionRange(q.length, q.length);
      box.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    }

    /** Type into the box and flush the 150ms debounce so the fetch fires. */
    function search(fixture: ReturnType<typeof renderWith>, q: string) {
      vi.useFakeTimers();
      type(fixture, q);
      vi.advanceTimersByTime(150);
      vi.useRealTimers();
      fixture.detectChanges();
    }

    const rows = (el: HTMLElement) =>
      Array.from(el.querySelectorAll('[role=option]')).map((row) =>
        (row.textContent ?? '').replace(/\s+/g, ' ').trim(),
      );

    it('narrows to a Mounted Container from the box, and leaves the box holding what was typed', () => {
      const { fixture, el } = ready();

      search(fixture, '$in:c-pack');

      // The token became the same `container` param a rail click sends: it narrows *within* the scope,
      // which still names every Mount.
      expect(entities.list).toHaveBeenLastCalledWith({ ...baseRead, container: ['c-pack'] });
      expect(searchBox(el).value).toBe('$in:c-pack');
      // The URL's `q` carries the raw string, so the link reproduces the box, not the residual.
      expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(
        [],
        expect.objectContaining({ queryParams: { q: '$in:c-pack' } }),
      );
    });

    it('excludes a Mounted Container with a leading dash', () => {
      const { fixture } = ready();

      search(fixture, '-$in:c-pack');

      expect(entities.list).toHaveBeenLastCalledWith({ ...baseRead, excludeContainer: ['c-pack'] });
    });

    it('reads a mixed box as both filters and a search', () => {
      const { fixture } = ready();

      search(fixture, 'goblin $type:core.type.note $tag:draft');

      expect(entities.list).toHaveBeenLastCalledWith({
        ...baseRead,
        q: 'goblin',
        type: ['core.type.note'],
        tag: ['draft'],
      });
    });

    it('maps a comparison onto the `field` param’s bound, off a key the registry knows', () => {
      TestBed.inject(TypeRegistry).setWorldFields([
        { id: 'test.field.cr', label: 'CR', dataType: { kind: 'number' }, required: false, facetable: true },
      ]);
      const { fixture } = ready();

      search(fixture, '$test.field.cr:>=5');

      expect(entities.list).toHaveBeenLastCalledWith({ ...baseRead, field: ['test.field.cr:gte:5'] });
    });

    it('says a $ name this browse cannot apply, and never searches for it', () => {
      const { fixture, el } = ready();

      // Visibility is the owning Container's business here, so the category is stripped from the rail —
      // and a token naming it would filter by a word that is false of this list (ADR-0079).
      search(fixture, 'goblin $visibility:private');

      expect(facet(el, 'unknown-facet')?.textContent).toContain('visibility');
      expect(entities.list).toHaveBeenLastCalledWith({ ...baseRead, q: 'goblin' });
    });

    it('renders the union of the typed and the clicked, the text winning a value both name', () => {
      const { fixture, el } = ready();

      // Clicked as an exclusion, then typed as an inclusion: one value, one visual state.
      facet(el, 'facet-exclude-container-c-pack')?.click();
      fixture.detectChanges();
      facet(el, 'facet-tag-draft')?.click();
      fixture.detectChanges();
      search(fixture, '$in:c-pack');

      expect(facet(el, 'facet-container-c-pack')?.getAttribute('aria-pressed')).toBe('true');
      expect(facet(el, 'facet-exclude-container-c-pack')?.getAttribute('aria-pressed')).toBe('false');
      // The clicked Tag is untouched beside it, and both ride the wire.
      expect(entities.list).toHaveBeenLastCalledWith({ ...baseRead, tag: ['draft'], container: ['c-pack'] });
    });

    it('marks the rows the text owns, and clicking one deletes exactly its token', () => {
      const { fixture, el } = ready();

      search(fixture, '$in:c-pack $tag:draft');
      expect(facet(el, 'facet-container-c-pack')?.getAttribute('data-query-owned')).toBe('');
      expect(facet(el, 'facet-tag-fantasy')?.getAttribute('data-query-owned')).toBeNull();

      facet(el, 'facet-container-c-pack')?.click();
      fixture.detectChanges();

      // Only that token left; the caller's other one stayed exactly as written.
      expect(searchBox(el).value).toBe('$tag:draft');
      expect(entities.list).toHaveBeenLastCalledWith({ ...baseRead, tag: ['draft'] });
    });

    it('never writes a clicked Facet into the box', () => {
      const { fixture, el } = ready();

      search(fixture, '$tag:draft');
      facet(el, 'facet-container-c-pack')?.click();
      fixture.detectChanges();

      expect(searchBox(el).value).toBe('$tag:draft');
      expect(TestBed.inject(Router).navigate).toHaveBeenLastCalledWith(
        [],
        expect.objectContaining({ queryParams: expect.objectContaining({ container: ['c-pack'], tag: null }) }),
      );
    });

    it('reproduces both stores from a shared link, and clears both with Clear all', () => {
      entities.facets.mockReturnValue(
        of({ type: [], tag: [{ value: 'draft', count: 1 }], visibility: [], fields: [], container: [] }),
      );
      worlds.mounts.mockReturnValue(of([shelf, pack]));
      entities.list.mockReturnValue(of({ items: [], nextCursor: null }));
      queryParams$.next(convertToParamMap({ q: 'goblin $tag:draft', container: 'c-pack' }));
      const fixture = TestBed.createComponent(LibraryPage);
      fixture.detectChanges();
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;

      expect(entities.list).toHaveBeenCalledWith({ ...baseRead, q: 'goblin', tag: ['draft'], container: ['c-pack'] });
      // One request on load, and the box holds the raw string the link carried.
      expect(entities.list).toHaveBeenCalledTimes(1);
      expect(searchBox(el).value).toBe('goblin $tag:draft');

      facet(el, 'facet-clear')?.click();
      fixture.detectChanges();

      expect(searchBox(el).value).toBe('');
      expect(entities.list).toHaveBeenLastCalledWith(baseRead);
    });

    it('offers this browse’s whole vocabulary on the dollar, and its Containers with their counts', () => {
      const { fixture, el } = ready();

      type(fixture, '$');
      // `in` is offered here and nowhere else; `visibility` is offered nowhere here.
      expect(rows(el)).toEqual(expect.arrayContaining(['type', 'tag', 'in']));
      expect(rows(el)).not.toContain('visibility');

      // Stage two comes off the Facet read this page already runs: a Container is named on screen and
      // addressed by id, exactly as the rail names it, and carries the count the rail shows.
      type(fixture, '$in:');
      expect(rows(el)).toEqual(['The Art Shelf1', 'Draw Steel: Monsters2']);
    });

    /**
     * A cold load on a shared link naming a **Field** key (ADR-0082, #430): the Fields read is still in
     * flight, so what the box filters to is not known yet. The read is held rather than made unfiltered
     * and corrected under the reader — and the hold ends on the response, whichever way it answers.
     */
    describe('a Facet key the registry cannot answer for yet', () => {
      const crField = {
        id: 'test.field.cr',
        label: 'CR',
        dataType: { kind: 'number' as const },
        required: false,
        facetable: true,
      };

      const awaiting = () => {
        const registry = TestBed.inject(TypeRegistry);
        registry.setWorldFields([]);
        registry.awaitWorldFields();
        return registry;
      };

      it('holds the first read, then makes it once — filtered — when the Fields land', () => {
        const registry = awaiting();
        queryParams$.next(convertToParamMap({ q: '$test.field.cr:5' }));
        const { fixture } = ready();

        expect(entities.list).not.toHaveBeenCalled();

        registry.setWorldFields([crField]);
        fixture.detectChanges();

        expect(entities.list).toHaveBeenCalledTimes(1);
        expect(entities.list).toHaveBeenCalledWith({ ...baseRead, field: ['test.field.cr:eq:5'] });
      });

      it('browses at once when the box names no Field key', () => {
        awaiting();
        queryParams$.next(convertToParamMap({ q: 'goblin $in:c-pack' }));
        ready();

        expect(entities.list).toHaveBeenCalledTimes(1);
        expect(entities.list).toHaveBeenCalledWith({ ...baseRead, q: 'goblin', container: ['c-pack'] });
      });

      /** The failure path: a refused read degrades to no World Fields, so the hold always ends. */
      it('browses, and states the miss, when the Fields read answers without the key', () => {
        const registry = awaiting();
        queryParams$.next(convertToParamMap({ q: 'goblin $test.field.cr:5' }));
        const { fixture, el } = ready();

        registry.setWorldFields([]); // what a failed read degrades to
        fixture.detectChanges();

        expect(entities.list).toHaveBeenCalledTimes(1);
        expect(entities.list).toHaveBeenCalledWith({ ...baseRead, q: 'goblin' });
        expect(facet(el, 'unknown-facet')?.textContent).toContain('test.field.cr');
      });
    });
  });

  it('renders its chrome and its empty Library in French when French is the active language', () => {
    const fixture = renderWith([]);
    const el = fixture.nativeElement as HTMLElement;

    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    expect(el.querySelector('h1')?.textContent).toContain('Ce dont ce monde se sert');
    expect(el.querySelector('[data-testid=no-mounts]')?.textContent).toContain('Ce monde ne se sert encore de rien.');
  });
});
