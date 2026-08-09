import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, ParamMap, provideRouter, Router } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { EntitySummary } from '@hexly/domain';
import { AssetsClient, EntitiesClient, ActiveWorld } from '@hexly/web-core';
import { MockEntitiesClient } from '@hexly/web-core/testing';
import { DialogService } from '@hexly/web-ui';
import { providePluginContent } from '@hexly/plugin-content/web';
import { providePluginAsset } from '@hexly/plugin-asset/web';
import { provideTranslocoTesting } from '../../../testing/transloco-testing';
import { AssetBrowserPage } from './asset-browser.page';
import { TypeRegistry } from '../../entity-types/type-registry';

/**
 * The Asset Browser's rail (ADR-0081, #423): the same paired toggles the Entity Browser gained, on the
 * surface where the ask is "art that is *not* already tagged as used". Only exclusion is pinned here —
 * the page's own behaviour (upload, tiles, the pinned type) is held by `asset-browser.spec.ts` e2e.
 */
describe('AssetBrowser', () => {
  let client: MockEntitiesClient;
  let navigate: ReturnType<typeof vi.spyOn>;
  let queryParams$: BehaviorSubject<ParamMap>;

  const summary = (over: Partial<EntitySummary> = {}): EntitySummary => ({
    id: 'a1',
    worldId: 'w1',
    name: 'aurora-banner',
    types: ['core.type.asset'],
    tags: [],
    visibility: 'private',
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    rights: ['read', 'delete'],
    ...over,
  });

  /** The list read the page always makes, minus whatever a test's filters add. */
  const baseRead = {
    limit: 50,
    worldId: 'w1',
    type: ['core.type.asset'],
    rights: true,
    thumbnails: true,
  };

  beforeEach(async () => {
    client = new MockEntitiesClient();
    queryParams$ = new BehaviorSubject<ParamMap>(convertToParamMap({}));
    await TestBed.configureTestingModule({
      imports: [AssetBrowserPage, provideTranslocoTesting()],
      providers: [
        providePluginContent(),
        providePluginAsset(),
        { provide: EntitiesClient, useValue: client },
        { provide: AssetsClient, useValue: { upload: vi.fn() } },
        { provide: DialogService, useValue: { open: vi.fn() } },
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { queryParamMap: queryParams$.asObservable() } },
      ],
    }).compileComponents();
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    TestBed.inject(ActiveWorld).set('w1');
  });

  const facet = (el: HTMLElement, testid: string) => el.querySelector<HTMLElement>(`[data-testid="${testid}"]`);

  /** Two Tags counted and on screen, with the next list read stubbed, ready for a toggle. */
  function ready() {
    client.facets.mockReturnValue(
      of({
        type: [],
        tag: [
          { value: 'used', count: 2 },
          { value: 'portrait-art', count: 1 },
        ],
        visibility: [],
        fields: [],
      }),
    );
    client.list.mockReturnValueOnce(of({ items: [summary()], nextCursor: null }));
    const fixture = TestBed.createComponent(AssetBrowserPage);
    fixture.detectChanges(); // active-World effect -> list()
    fixture.detectChanges();
    client.list.mockReturnValue(of({ items: [], nextCursor: null }));
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('excluding a Tag sends excludeTag on the list and the Facet read, and mirrors it to the URL', () => {
    const { fixture, el } = ready();

    // Find art that is *not* already tagged as used — one click, not one per other tag.
    facet(el, 'facet-exclude-tag-used')?.click();
    fixture.detectChanges();

    expect(client.list).toHaveBeenLastCalledWith({ ...baseRead, excludeTag: ['used'] });
    // The counts drill down against the exclusion too, or the rail would annotate a list it disagrees with.
    expect(client.facets).toHaveBeenLastCalledWith({
      worldId: 'w1',
      type: ['core.type.asset'],
      excludeTag: ['used'],
    });
    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({ queryParams: expect.objectContaining({ excludeTag: ['used'] }) }),
    );
  });

  it('is reversible by clicking the same control', () => {
    const { fixture, el } = ready();

    facet(el, 'facet-exclude-tag-used')?.click();
    fixture.detectChanges();
    expect(facet(el, 'facet-exclude-tag-used')?.getAttribute('aria-pressed')).toBe('true');

    facet(el, 'facet-exclude-tag-used')?.click();
    fixture.detectChanges();

    expect(client.list).toHaveBeenLastCalledWith(baseRead);
  });

  it('releases the exclusion when include is pressed, and the inclusion when exclude is', () => {
    const { fixture, el } = ready();

    facet(el, 'facet-exclude-tag-used')?.click();
    fixture.detectChanges();

    // Never both: the contradiction stays out of the rail's reach by construction (ADR-0081).
    facet(el, 'facet-tag-used')?.click();
    fixture.detectChanges();
    expect(client.list).toHaveBeenLastCalledWith({ ...baseRead, tag: ['used'] });
    expect(facet(el, 'facet-exclude-tag-used')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('excludes a Field value through the `field` param’s own `neq` op', () => {
    client.facets.mockReturnValue(
      of({
        type: [],
        tag: [],
        visibility: [],
        fields: [
          {
            key: 'orientation',
            label: 'Orientation',
            dataType: { kind: 'enum', options: ['landscape', 'portrait'] },
            values: [{ value: 'portrait', count: 1 }],
          },
        ],
      }),
    );
    client.list.mockReturnValueOnce(of({ items: [summary()], nextCursor: null }));
    const fixture = TestBed.createComponent(AssetBrowserPage);
    fixture.detectChanges();
    fixture.detectChanges();
    client.list.mockReturnValue(of({ items: [], nextCursor: null }));

    facet(fixture.nativeElement as HTMLElement, 'facet-exclude-field-orientation-portrait')?.click();
    fixture.detectChanges();

    expect(client.list).toHaveBeenLastCalledWith({ ...baseRead, field: ['orientation:neq:portrait'] });
  });

  /** A refresh, or a shared link, reproduces the browse. */
  it('seeds exclusions from the URL into the first fetch and lights their controls', () => {
    client.facets.mockReturnValue(
      of({ type: [], tag: [{ value: 'portrait-art', count: 1 }], visibility: [], fields: [] }),
    );
    client.list.mockReturnValueOnce(of({ items: [], nextCursor: null }));
    queryParams$.next(convertToParamMap({ excludeTag: 'used' }));
    const fixture = TestBed.createComponent(AssetBrowserPage);
    fixture.detectChanges();
    fixture.detectChanges();

    expect(client.list).toHaveBeenCalledWith({ ...baseRead, excludeTag: ['used'] });
    // One request on load — the seeded browse is the first one, not a correction of an empty one.
    expect(client.list).toHaveBeenCalledTimes(1);
    // And the excluded Tag is listed although the drill-down stopped counting it — or the exclusion
    // would be a one-way door, with no row left to click off.
    const el = fixture.nativeElement as HTMLElement;
    expect(facet(el, 'facet-exclude-tag-used')?.getAttribute('aria-pressed')).toBe('true');
    expect(facet(el, 'facet-tag-used')?.querySelector('span.tabular-nums')?.textContent?.trim()).toBe('0');
  });

  it('offers Clear all for an exclusion alone, and clears both polarities', () => {
    const { fixture, el } = ready();

    facet(el, 'facet-tag-portrait-art')?.click();
    fixture.detectChanges();
    facet(el, 'facet-exclude-tag-used')?.click();
    fixture.detectChanges();
    expect(facet(el, 'facet-clear')).not.toBeNull();

    facet(el, 'facet-clear')?.click();
    fixture.detectChanges();

    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({
        queryParams: { q: null, tag: null, visibility: null, field: null, excludeTag: null, excludeVisibility: null },
      }),
    );
    expect(client.list).toHaveBeenLastCalledWith(baseRead);
  });

  /**
   * A Facet named inline rather than clicked (ADR-0082, #428). The grammar belongs to the domain
   * parser's spec and the two-store rule to the Entity Browser's; what is this surface's own is its
   * **vocabulary** — the harvested image dimensions, and the `$type:` it must *not* honour, the asset
   * type being pinned here rather than a choice.
   */
  describe('Facet Tokens (#428)', () => {
    const searchBox = (el: HTMLElement) => el.querySelector('[data-testid=entity-search]') as HTMLInputElement;

    /** Put `q` in the box with the caret at its end, as a caller typing it would. */
    function type(fixture: ReturnType<typeof ready>['fixture'], q: string) {
      const box = searchBox(fixture.nativeElement);
      box.value = q;
      box.setSelectionRange(q.length, q.length);
      box.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    }

    /** Type into the box and flush the 150ms debounce so the fetch fires. */
    function search(fixture: ReturnType<typeof ready>['fixture'], q: string) {
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

    it('applies a typed Tag, and leaves the box holding exactly what was typed', () => {
      const { fixture, el } = ready();

      search(fixture, '$tag:used');

      expect(client.list).toHaveBeenLastCalledWith({ ...baseRead, tag: ['used'] });
      expect(searchBox(el).value).toBe('$tag:used');
      // The URL's `q` carries the raw string, so the link reproduces the box, not the residual.
      expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { q: '$tag:used' } }));
    });

    it('reads a mixed box as an exclusion and a search', () => {
      const { fixture } = ready();

      search(fixture, 'banner -$tag:used');

      expect(client.list).toHaveBeenLastCalledWith({ ...baseRead, q: 'banner', excludeTag: ['used'] });
    });

    it('names a harvested image dimension, onto the same `field` param the rail uses', () => {
      const { fixture } = ready();

      // `orientation` is the asset data type's own harvested dimension (ADR-0055/0065), and reaches the
      // vocabulary through the client registry like any other Facet key.
      search(fixture, '$orientation:landscape');

      expect(client.list).toHaveBeenLastCalledWith({ ...baseRead, field: ['orientation:eq:landscape'] });
    });

    it('says a $type is not a Facet here rather than unpinning the asset type', () => {
      const { fixture, el } = ready();

      search(fixture, 'banner $type:core.type.note');

      expect(el.querySelector('[data-testid=unknown-facet]')?.textContent).toContain('type');
      // The pin stands: the list is still the asset type's, and the token never reached the wire.
      expect(client.list).toHaveBeenLastCalledWith({ ...baseRead, q: 'banner' });
    });

    it('renders the union of the typed and the clicked, the text winning a value both name', () => {
      const { fixture, el } = ready();

      // Clicked as an exclusion, then typed as an inclusion: one value, one visual state.
      facet(el, 'facet-exclude-tag-used')?.click();
      fixture.detectChanges();
      facet(el, 'facet-tag-portrait-art')?.click();
      fixture.detectChanges();
      search(fixture, '$tag:used');

      expect(facet(el, 'facet-tag-used')?.getAttribute('aria-pressed')).toBe('true');
      expect(facet(el, 'facet-exclude-tag-used')?.getAttribute('aria-pressed')).toBe('false');
      expect(client.list).toHaveBeenLastCalledWith({ ...baseRead, tag: ['used', 'portrait-art'] });
    });

    it('marks the rows the text owns, and clicking one deletes exactly its token', () => {
      const { fixture, el } = ready();

      search(fixture, '$tag:used $tag:portrait-art');
      expect(facet(el, 'facet-tag-used')?.getAttribute('data-query-owned')).toBe('');

      facet(el, 'facet-tag-used')?.click();
      fixture.detectChanges();

      // Only that token left; the caller's other one stayed exactly as written.
      expect(searchBox(el).value).toBe('$tag:portrait-art');
      expect(client.list).toHaveBeenLastCalledWith({ ...baseRead, tag: ['portrait-art'] });
    });

    it('never writes a clicked Facet into the box, and Clear all empties both stores', () => {
      const { fixture, el } = ready();

      search(fixture, '$tag:used');
      facet(el, 'facet-tag-portrait-art')?.click();
      fixture.detectChanges();
      expect(searchBox(el).value).toBe('$tag:used');
      expect(navigate).toHaveBeenLastCalledWith(
        [],
        expect.objectContaining({ queryParams: expect.objectContaining({ tag: ['portrait-art'] }) }),
      );

      facet(el, 'facet-clear')?.click();
      fixture.detectChanges();

      expect(searchBox(el).value).toBe('');
      expect(client.list).toHaveBeenLastCalledWith(baseRead);
    });

    it('reproduces both stores from a shared link', () => {
      client.facets.mockReturnValue(of({ type: [], tag: [{ value: 'used', count: 1 }], visibility: [], fields: [] }));
      client.list.mockReturnValueOnce(of({ items: [], nextCursor: null }));
      queryParams$.next(convertToParamMap({ q: 'banner -$tag:used', tag: 'portrait-art' }));
      const fixture = TestBed.createComponent(AssetBrowserPage);
      fixture.detectChanges();
      fixture.detectChanges();

      expect(client.list).toHaveBeenCalledWith({
        ...baseRead,
        q: 'banner',
        tag: ['portrait-art'],
        excludeTag: ['used'],
      });
      // One request on load, and the box holds the raw string the link carried.
      expect(client.list).toHaveBeenCalledTimes(1);
      expect(searchBox(fixture.nativeElement).value).toBe('banner -$tag:used');
    });

    it('offers this browse’s whole vocabulary on the dollar, and its Tags with their counts', () => {
      const { fixture, el } = ready();

      type(fixture, '$');
      // The harvested image dimensions are in it; the pinned Type and the single Container are not.
      expect(rows(el)).toEqual(expect.arrayContaining(['tag', 'visibility', 'kind', 'orientation', 'hue']));
      expect(rows(el)).not.toContain('type');
      expect(rows(el)).not.toContain('in');

      // Stage two comes off the Facet read this page already runs, counts and all.
      type(fixture, '$tag:');
      expect(rows(el)).toEqual(['used2', 'portrait-art1']);
    });

    /**
     * A cold load on a shared link naming a **Field** key (ADR-0082, #430): the Fields read is still in
     * flight, so what the box filters to is not known yet. The read is held rather than made unfiltered
     * — every Asset in the World — and corrected under the reader once the response lands.
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

      const render = (q: string) => {
        queryParams$.next(convertToParamMap({ q }));
        client.list.mockReturnValue(of({ items: [], nextCursor: null }));
        const fixture = TestBed.createComponent(AssetBrowserPage);
        fixture.detectChanges();
        return fixture;
      };

      it('holds the first read, then makes it once — filtered — when the Fields land', () => {
        const registry = awaiting();
        const fixture = render('$test.field.cr:5');

        expect(client.list).not.toHaveBeenCalled();

        registry.setWorldFields([crField]);
        fixture.detectChanges();

        expect(client.list).toHaveBeenCalledTimes(1);
        expect(client.list).toHaveBeenCalledWith({ ...baseRead, field: ['test.field.cr:eq:5'] });
      });

      it('browses at once when the box names no Field key', () => {
        awaiting();

        render('banner -$tag:used');

        expect(client.list).toHaveBeenCalledTimes(1);
        expect(client.list).toHaveBeenCalledWith({ ...baseRead, q: 'banner', excludeTag: ['used'] });
      });

      /** The failure path: a refused read degrades to no World Fields, so the hold always ends. */
      it('browses when the Fields read answers without the key', () => {
        const registry = awaiting();
        const fixture = render('banner $test.field.cr:5');

        registry.setWorldFields([]); // what a failed read degrades to
        fixture.detectChanges();

        expect(client.list).toHaveBeenCalledTimes(1);
        expect(client.list).toHaveBeenCalledWith({ ...baseRead, q: 'banner' });
      });
    });
  });
});
