import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AssetSummary, EntityDetail, EntityFacets } from '@hexly/domain';
import { AssetsClient, AssetSearchParams } from '@hexly/web-core';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { DialogRef } from '@hexly/web-ui';
import { BOARD_TEST_CATALOGS } from '../i18n/test-catalogs';
import { BoardImagePickerComponent, ImagePickerData } from './board-image-picker.component';

/** Fixture value copy for the harvested `orientation` dimension — a hermetic stand-in for the asset catalog. */
const FIXTURE_CATALOGS = {
  'fixture/en': { orient: { landscape: 'Wide' } },
  'fixture/fr': { orient: { landscape: 'Panoramique' } },
};

const EXISTING: AssetSummary[] = [
  {
    url: '/assets/w1/one.png',
    thumbnailUrl: '/assets/w1/one.thumb.webp',
    originalFilename: 'one.png',
    mime: 'image/png',
    size: 10,
  },
  {
    url: '/assets/w1/two.jpg',
    thumbnailUrl: '/assets/w1/two.thumb.webp',
    originalFilename: 'two.jpg',
    mime: 'image/jpeg',
    size: 20,
  },
];

/** Facet counts the server returns pinned to the asset type + image kind — the picker drops the pinned `kind`. */
const FACETS: EntityFacets = {
  type: [],
  tag: [],
  visibility: [],
  fields: [
    {
      key: 'kind',
      label: 'asset.facet.kind',
      labelKey: 'asset.facet.kind',
      dataType: { kind: 'enum', options: ['image', 'pdf', 'audio', 'other'] },
      values: [{ value: 'image', count: 2 }],
    },
    {
      key: 'orientation',
      label: 'asset.facet.orientation',
      labelKey: 'asset.facet.orientation',
      // A per-value key prefix (ADR-0055/0065): each value resolves as `<valuesKeyPrefix>.<value>`. A fixture
      // scope keeps the spec hermetic; `portrait` has no copy, so it must fall back to the raw token.
      valuesKeyPrefix: 'fixture.orient',
      dataType: { kind: 'enum', options: ['landscape', 'portrait', 'square'] },
      values: [
        { value: 'landscape', count: 1 },
        { value: 'portrait', count: 1 },
      ],
    },
  ],
};

/** The wrapper Asset Entity the upload endpoint returns (ADR-0065) — the picker reads its URL off the ref. */
const NEW_ASSET = {
  id: 'asset-new',
  name: 'new',
  document: { 'core.field.asset': { hash: 'a'.repeat(64), ext: '.png', mime: 'image/png', size: 5, stats: null } },
} as unknown as EntityDetail;

/** A fake AssetsClient the picker drives — records the search params + upload, and returns canned streams. */
class FakeAssetsClient {
  uploaded: File | null = null;
  lastSearch: AssetSearchParams | null = null;
  lastFacets: AssetSearchParams | null = null;
  searchResult = EXISTING;
  uploadResult = of<EntityDetail>(NEW_ASSET);
  search = (_worldId: string, params: AssetSearchParams = {}) => {
    this.lastSearch = params;
    return of(this.searchResult);
  };
  facets = (_worldId: string, params: AssetSearchParams = {}) => {
    this.lastFacets = params;
    return of(FACETS);
  };
  upload = (_worldId: string, file: File) => {
    this.uploaded = file;
    return this.uploadResult;
  };
}

describe('BoardImagePicker', () => {
  let fixture: ComponentFixture<BoardImagePickerComponent>;
  let ref: DialogRef<ImagePickerData, string>;
  let closed: (string | undefined)[];
  let assets: FakeAssetsClient;

  beforeEach(async () => {
    assets = new FakeAssetsClient();
    ref = new DialogRef<ImagePickerData, string>({ worldId: 'w1' });
    closed = [];
    ref.closed.subscribe((r) => closed.push(r));

    await TestBed.configureTestingModule({
      imports: [BoardImagePickerComponent, provideTranslocoTesting(BOARD_TEST_CATALOGS, FIXTURE_CATALOGS)],
      providers: [
        { provide: DialogRef, useValue: ref },
        { provide: AssetsClient, useValue: assets },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(BoardImagePickerComponent);
    fixture.detectChanges();
  });

  it('uploads a picked file (minting an Asset) and closes with the served URL', () => {
    const input = fixture.nativeElement.querySelector('[data-testid=image-upload-input]') as HTMLInputElement;
    const file = new File(['x'], 'castle.png', { type: 'image/png' });
    // jsdom lets us stand in a FileList via defineProperty on the input.
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));

    expect(assets.uploaded).toBe(file);
    // The URL is derived from the wrapper's asset-ref (ADR-0065): /assets/<worldId>/<hash><ext>.
    expect(closed).toEqual([`/assets/w1/${'a'.repeat(64)}.png`]);
  });

  it('closes with an existing Asset’s URL when one is picked (reuse, no upload)', () => {
    const tile = fixture.nativeElement.querySelector('[data-testid=image-asset-choice]') as HTMLButtonElement;
    tile.click();

    expect(assets.uploaded).toBeNull();
    expect(closed).toEqual(['/assets/w1/one.png']);
  });

  it('keeps the dialog open with an error hint when an upload fails', () => {
    assets.uploadResult = throwError(() => new Error('boom'));
    const input = fixture.nativeElement.querySelector('[data-testid=image-upload-input]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'x.png')], configurable: true });
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(closed).toEqual([]); // never closed
    expect(fixture.nativeElement.querySelector('[data-testid=image-upload-error]')).not.toBeNull();
  });

  it('searches Assets by name through the pinned entity-search (#281)', () => {
    const search = fixture.nativeElement.querySelector('[data-testid=image-search]') as HTMLInputElement;
    search.value = 'castle';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    // The query rides to the server as `q` — no client-side name filter (same contract as the Asset Browser).
    expect(assets.lastSearch).toEqual({ q: 'castle', field: [] });
    expect(assets.lastFacets).toEqual({ q: 'castle', field: [] });
  });

  it('offers image Facets and filters by them, hiding the pinned kind dimension (#281)', () => {
    // The pinned `kind` dimension is never a picker choice; the orientation Facet is.
    expect(fixture.nativeElement.querySelector('[data-testid=image-facet-kind]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid=image-facet-orientation]')).not.toBeNull();

    const chip = fixture.nativeElement.querySelector(
      '[data-testid=image-facet-orientation-landscape]',
    ) as HTMLButtonElement;
    chip.click();
    fixture.detectChanges();

    // Toggling a Facet AND-s its `key:eq:value` token into the search (the server pins image kind on top).
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(assets.lastSearch).toEqual({ q: undefined, field: ['orientation:eq:landscape'] });
  });

  it('translates a Facet VALUE via its key prefix, falling back to the raw token when uncopied (ADR-0055/0065)', () => {
    const chipLabel = (value: string) =>
      (
        fixture.nativeElement.querySelector(
          `[data-testid=image-facet-orientation-${value}] span:first-child`,
        ) as HTMLElement
      ).textContent?.trim();

    // `landscape` has fixture copy → translated; `portrait` has none → raw token, never the bare key.
    expect(chipLabel('landscape')).toBe('Wide');
    expect(chipLabel('portrait')).toBe('portrait');
  });

  it('reads "no matches" (not "no images") when a search narrows to nothing', () => {
    assets.searchResult = [];
    const search = fixture.nativeElement.querySelector('[data-testid=image-search]') as HTMLInputElement;
    search.value = 'nope';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect((fixture.nativeElement.querySelector('[data-testid=image-empty]') as HTMLElement).textContent).toContain(
      'No images match your search.',
    );
  });

  it('cancels without choosing — closes with no result, so nothing is placed', () => {
    const cancel = fixture.nativeElement.querySelector('[data-testid=image-picker-cancel]') as HTMLButtonElement;
    cancel.click();

    expect(closed).toEqual([undefined]);
  });
});
