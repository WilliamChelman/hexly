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
});
