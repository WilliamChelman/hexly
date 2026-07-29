import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { EntityDetail, EntityFacets, EntityPage, EntitySummary } from '@hexly/domain';
import { AssetsClient, EntitiesClient } from '@hexly/web-core';
import { MockEntitiesClient, provideTranslocoTesting } from '@hexly/web-core/testing';
import { COLLAB_TEST_CATALOGS } from '@hexly/web-entity/testing';
import { DialogRef } from '@hexly/web-ui';
import { BOARD_TEST_CATALOGS } from '../i18n/test-catalogs';
import { BoardImagePickerComponent, ImagePickerData } from './board-image-picker.component';

/** Fixture value copy for the harvested `orientation` dimension — a hermetic stand-in for the asset catalog. */
const FIXTURE_CATALOGS = {
  'fixture/en': { orient: { landscape: 'Wide' } },
  'fixture/fr': { orient: { landscape: 'Panoramique' } },
};

/**
 * An image Asset as the one link-target read answers with it (#416): the tile the grid draws
 * (`thumbnailUrl`) and the full-resolution capability URL an Image element stores (`assetUrl`), both
 * already resolved against the Asset's *own* Container by the server.
 */
function asset(id: string, name: string, containerId = 'w1'): EntitySummary {
  return {
    id,
    worldId: containerId,
    name,
    types: ['core.type.asset'],
    tags: [],
    visibility: 'shared',
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    assetUrl: `/assets/${containerId}/${id}.png`,
    thumbnailUrl: `/assets/${containerId}/${id}.thumb.webp`,
  };
}

const EXISTING = [asset('one', 'one'), asset('two', 'two')];

const page = (items: EntitySummary[]): EntityPage => ({ items, nextCursor: null });

/** The Container facet a widened read grows (ADR-0080): this World, and the Shelf it Mounts. */
const MOUNTED_CONTAINERS = [
  { value: 'w1', label: 'Aldermoor', count: 1 },
  { value: 'shelf', label: 'The Art Shelf', count: 1 },
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

/** A fake AssetsClient the picker drives — records the uploaded file and returns a canned wrapper. */
class FakeAssetsClient {
  uploaded: File | null = null;
  uploadResult = of<EntityDetail>(NEW_ASSET);
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
  let entities: MockEntitiesClient;

  beforeEach(async () => {
    assets = new FakeAssetsClient();
    entities = new MockEntitiesClient();
    entities.list.mockReturnValue(of(page(EXISTING)));
    entities.facets.mockReturnValue(of(FACETS));
    ref = new DialogRef<ImagePickerData, string>({ worldId: 'w1' });
    closed = [];
    ref.closed.subscribe((r) => closed.push(r));

    await TestBed.configureTestingModule({
      imports: [
        BoardImagePickerComponent,
        provideTranslocoTesting(BOARD_TEST_CATALOGS, COLLAB_TEST_CATALOGS, FIXTURE_CATALOGS),
      ],
      providers: [
        { provide: DialogRef, useValue: ref },
        { provide: AssetsClient, useValue: assets },
        { provide: EntitiesClient, useValue: entities },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(BoardImagePickerComponent);
    fixture.detectChanges();
  });

  const byId = (testid: string) => fixture.nativeElement.querySelector(`[data-testid=${testid}]`) as HTMLElement | null;

  it('uploads a picked file (minting an Asset) and closes with the served URL', () => {
    const input = byId('image-upload-input') as HTMLInputElement;
    const file = new File(['x'], 'castle.png', { type: 'image/png' });
    // jsdom lets us stand in a FileList via defineProperty on the input.
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));

    expect(assets.uploaded).toBe(file);
    // The URL is derived from the wrapper's asset-ref (ADR-0065): /assets/<worldId>/<hash><ext>.
    expect(closed).toEqual([`/assets/w1/${'a'.repeat(64)}.png`]);
  });

  it('closes with an existing Asset’s URL when one is picked (reuse, no upload)', () => {
    (byId('image-asset-choice') as HTMLButtonElement).click();

    expect(assets.uploaded).toBeNull();
    expect(closed).toEqual(['/assets/w1/one.png']);
  });

  it('keeps the dialog open with an error hint when an upload fails', () => {
    assets.uploadResult = throwError(() => new Error('boom'));
    const input = byId('image-upload-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'x.png')], configurable: true });
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(closed).toEqual([]); // never closed
    expect(byId('image-upload-error')).not.toBeNull();
  });

  it('asks the one link-target read, preset to the asset type + image kind (#416)', () => {
    const search = byId('image-search') as HTMLInputElement;
    search.value = 'castle';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    // The query rides to the server as `q` — no client-side name filter — through the read every link
    // picker asks, so there is no second listing seam left to teach Mount scope to (ADR-0080). The type
    // pin is also what lifts the hidden-from-default-listing exclusion Assets carry (ADR-0065).
    const expected = {
      q: 'castle',
      worldId: 'w1',
      type: ['core.type.asset'],
      field: ['kind:eq:image'],
      container: undefined,
      read: 'link-target',
    };
    // Unpaginated, as this grid has always been: the shared list ceiling, not the default page size.
    expect(entities.list).toHaveBeenLastCalledWith({ ...expected, thumbnails: true, limit: 200 });
    // The rail comes off that same read, so it can never annotate a grid it disagrees with.
    expect(entities.facets).toHaveBeenLastCalledWith(expected);
  });

  it('offers image Facets and filters by them, hiding the pinned kind dimension (#281)', () => {
    // The pinned `kind` dimension is never a picker choice; the orientation Facet is.
    expect(byId('image-facet-kind')).toBeNull();
    expect(byId('image-facet-orientation')).not.toBeNull();

    const chip = byId('image-facet-orientation-landscape') as HTMLButtonElement;
    chip.click();
    fixture.detectChanges();

    // Toggling a Facet AND-s its `key:eq:value` token onto the pinned image kind.
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(entities.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ field: ['kind:eq:image', 'orientation:eq:landscape'] }),
    );
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

  it('offers a Mounted shelf’s art beside this World’s own, placing it under the shelf’s Container', () => {
    // What the widened read answers: this World's art first, then the shelf's (ADR-0080), each carrying
    // the URL its own Container serves — which is what makes a placed shelf image render for every reader.
    entities.list.mockReturnValue(of(page([asset('own', 'Tavern Sign'), asset('art', 'Sunset', 'shelf')])));
    entities.facets.mockReturnValue(of({ ...FACETS, container: MOUNTED_CONTAINERS }));
    fixture = TestBed.createComponent(BoardImagePickerComponent);
    fixture.detectChanges();

    expect(byId('image-container-shelf')?.textContent).toContain('The Art Shelf');
    const shelfTile = fixture.nativeElement.querySelector('[data-asset-id=art]') as HTMLButtonElement;
    expect((shelfTile.querySelector('img') as HTMLImageElement).src).toContain('/assets/shelf/art.thumb.webp');

    shelfTile.click();
    expect(closed).toEqual(['/assets/shelf/art.png']);
  });

  it('narrows to one Container through the chips (ADR-0080)', () => {
    entities.facets.mockReturnValue(of({ ...FACETS, container: MOUNTED_CONTAINERS }));
    fixture = TestBed.createComponent(BoardImagePickerComponent);
    fixture.detectChanges();

    (byId('image-container-shelf') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(entities.list).toHaveBeenLastCalledWith(expect.objectContaining({ container: ['shelf'] }));
  });

  it('shows no Container chips in a World that Mounts nothing — the picker exactly as it was', () => {
    expect(byId('image-containers')).toBeNull();
  });

  it('reads "no matches" (not "no images") when a search narrows to nothing', () => {
    entities.list.mockReturnValue(of(page([])));
    const search = byId('image-search') as HTMLInputElement;
    search.value = 'nope';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect((byId('image-empty') as HTMLElement).textContent).toContain('No images match your search.');
  });

  it('cancels without choosing — closes with no result, so nothing is placed', () => {
    (byId('image-picker-cancel') as HTMLButtonElement).click();

    expect(closed).toEqual([undefined]);
  });
});
