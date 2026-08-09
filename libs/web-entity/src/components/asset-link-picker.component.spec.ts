import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { EntityDetail, EntityLinkValue, EntityPage, EntitySummary } from '@hexly/domain';
import { AssetsClient, EntitiesClient } from '@hexly/web-core';
import { MockEntitiesClient, provideTranslocoTesting } from '@hexly/web-core/testing';
import { UI_TEST_CATALOGS } from '@hexly/web-ui/testing';
import { provideEntityTypesTesting } from '../testing/entity-types.fake';
import { AssetLinkPickerComponent } from './asset-link-picker.component';
import { COLLAB_TEST_CATALOGS, WEB_ENTITY_TEST_CATALOGS } from '../i18n/test-catalogs';

/** An image Asset Entity summary carrying the thumbnail the picker previews (thumbnails=1). */
function asset(id: string, name = id, thumbnailUrl = `/assets/w1/${id}.thumb.webp`): EntitySummary {
  return {
    id,
    worldId: 'w1',
    name,
    types: ['core.type.asset'],
    tags: [],
    visibility: 'private',
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    thumbnailUrl,
  };
}

const page = (items: EntitySummary[]): EntityPage => ({ items, nextCursor: null });

/** The wrapper Asset Entity an upload mints (ADR-0065) — the picker stores its id as the link. */
const UPLOADED = { id: 'asset-new', name: 'castle.png' } as unknown as EntityDetail;

/** A fake AssetsClient the picker drives — records the uploaded file and returns a canned wrapper. */
class FakeAssetsClient {
  uploaded: File | null = null;
  uploadResult = of<EntityDetail>(UPLOADED);
  upload = (_worldId: string, file: File) => {
    this.uploaded = file;
    return this.uploadResult;
  };
}

/** A host owning the value + query, mirroring how the field control embeds the picker. */
@Component({
  imports: [AssetLinkPickerComponent],
  template: `<app-asset-link-picker
    [value]="value()"
    [worldId]="'w1'"
    [disabled]="disabled"
    (valueChange)="changed = $event"
  />`,
})
class Host {
  readonly value = signal<EntityLinkValue | null>(null);
  disabled = false;
  changed: EntityLinkValue | undefined | 'unset' = 'unset';
}

describe('AssetLinkPicker', () => {
  let entities: MockEntitiesClient;
  let assets: FakeAssetsClient;

  beforeEach(async () => {
    entities = new MockEntitiesClient();
    assets = new FakeAssetsClient();
    // Branch on the read: an `ids` read resolves the current value's tile; a `type` read is the picker search.
    entities.list.mockImplementation((o) => {
      if (o?.ids) return of(page([asset(o.ids[0], 'The Whisperwood')]));
      return of(page([asset('img-1', 'Castle'), asset('img-2', 'Forest')]));
    });
    await TestBed.configureTestingModule({
      imports: [Host, provideTranslocoTesting(WEB_ENTITY_TEST_CATALOGS, COLLAB_TEST_CATALOGS, UI_TEST_CATALOGS)],
      providers: [
        { provide: EntitiesClient, useValue: entities },
        { provide: AssetsClient, useValue: assets },
        // The box reads its Facet vocabulary off the registry, synchronously (ADR-0082).
        provideEntityTypesTesting([]),
      ],
    }).compileComponents();
  });

  const byId = (el: HTMLElement, testid: string) => el.querySelector(`[data-testid=${testid}]`) as HTMLElement | null;

  function render() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('opens a pick-or-upload panel that filters results to image-kind Assets and previews them as tiles', () => {
    const { fixture, el } = render();
    // Closed until opened, so no premature search fires.
    expect(byId(el, 'asset-link-search')).toBeNull();

    (byId(el, 'asset-link-open') as HTMLButtonElement).click();
    fixture.detectChanges();

    // The upload input and the search box are both offered.
    expect((byId(el, 'asset-link-upload') as HTMLInputElement).accept).toBe('image/*');
    expect(byId(el, 'asset-link-search')).not.toBeNull();
    // The search is pinned to the asset type + the image kind facet token.
    expect(entities.list).toHaveBeenCalledWith(
      expect.objectContaining({ type: ['core.type.asset'], field: ['kind:eq:image'], thumbnails: true }),
    );
    // Results render as preview tiles (an <img> from thumbnailUrl), picked by sight.
    const tile = byId(el, 'asset-link-option-img-1');
    expect(tile).not.toBeNull();
    expect((tile?.querySelector('img') as HTMLImageElement).src).toContain('/assets/w1/img-1.thumb.webp');
  });

  it('stores the picked Asset’s entityId (plus a name snapshot) as the field value', () => {
    const { fixture, el } = render();
    (byId(el, 'asset-link-open') as HTMLButtonElement).click();
    fixture.detectChanges();

    (byId(el, 'asset-link-option-img-2') as HTMLButtonElement).click();

    expect(fixture.componentInstance.changed).toEqual({ entityId: 'img-2', label: 'Forest' });
  });

  it('uploading in place stores the new Asset’s entityId as the field value', () => {
    const { fixture, el } = render();
    (byId(el, 'asset-link-open') as HTMLButtonElement).click();
    fixture.detectChanges();

    const input = byId(el, 'asset-link-upload') as HTMLInputElement;
    const file = new File(['x'], 'castle.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));

    expect(assets.uploaded).toBe(file);
    expect(fixture.componentInstance.changed).toEqual({ entityId: 'asset-new', label: 'castle.png' });
  });

  it('keeps the panel open with an error hint when an upload fails', () => {
    assets.uploadResult = throwError(() => new Error('boom'));
    const { fixture, el } = render();
    (byId(el, 'asset-link-open') as HTMLButtonElement).click();
    fixture.detectChanges();

    const input = byId(el, 'asset-link-upload') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'x.png')], configurable: true });
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(fixture.componentInstance.changed).toBe('unset'); // never committed
    expect(byId(el, 'asset-link-error')).not.toBeNull();
  });

  it('previews a value living in a Mounted Container — resolving it names no World (ADR-0080)', () => {
    // Bytes served from the Shelf's own Container, as a Mounted target's are.
    entities.list.mockImplementation((o) =>
      of(o?.ids ? page([asset('shelf-art', 'Sunset', '/assets/shelf-9/shelf-art.thumb.webp')]) : page([])),
    );
    const { fixture, el } = render();
    fixture.componentInstance.value.set({ entityId: 'shelf-art', label: 'Sunset' });
    fixture.detectChanges();

    // "Resolve exactly this id" is no browse: naming a World would scope the lookup to it and blank the
    // preview of the very link this picker offered from a Shelf the World Mounts.
    expect(entities.list).toHaveBeenCalledWith({ ids: ['shelf-art'], thumbnails: true });
    expect((byId(el, 'asset-link-preview') as HTMLImageElement).src).toContain('/assets/shelf-9/shelf-art.thumb.webp');
    expect(byId(el, 'asset-link-placeholder')).toBeNull();
  });

  it('previews the current value as a tile and clears it on demand', () => {
    const { fixture, el } = render();
    fixture.componentInstance.value.set({ entityId: 'whisperwood', label: 'The Whisperwood' });
    fixture.detectChanges();

    // The current value resolves to a preview tile via a by-ids read with thumbnails=1.
    expect(byId(el, 'asset-link-value')?.textContent).toContain('The Whisperwood');
    expect((byId(el, 'asset-link-preview') as HTMLImageElement).src).toContain('/assets/w1/whisperwood.thumb.webp');

    (byId(el, 'asset-link-clear') as HTMLButtonElement).click();
    expect(fixture.componentInstance.changed).toBeUndefined();
  });

  it('asks for a link target, so a Mounted shelf’s art is offered and narrowable to it (ADR-0080)', () => {
    // The Container facet a widened read grows — this World and the Shelf it Mounts.
    entities.facets.mockReturnValue(
      of({
        type: [],
        tag: [],
        visibility: [],
        fields: [],
        container: [
          { value: 'w1', label: 'Aldermoor', count: 1 },
          { value: 'shelf', label: 'The Art Shelf', count: 1 },
        ],
      }),
    );
    const { fixture, el } = render();
    (byId(el, 'asset-link-open') as HTMLButtonElement).click();
    fixture.detectChanges();

    // Pointing at an Asset is pointing at an Entity, so the search declares itself a link-target read —
    // which is the whole of what offers a mounted Shelf's art beside this World's own.
    expect(entities.list).toHaveBeenCalledWith(expect.objectContaining({ read: 'link-target', worldId: 'w1' }));
    // The chips are counted off that same read, its own selection dropped as every drill-down facet's is.
    expect(entities.facets).toHaveBeenCalledWith(
      expect.objectContaining({ read: 'link-target', container: undefined }),
    );
    expect(byId(el, 'asset-link-container-shelf')?.textContent).toContain('The Art Shelf');

    // Narrowing to one Shelf re-reads through the same scope, narrowed.
    (byId(el, 'asset-link-container-shelf') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(entities.list).toHaveBeenLastCalledWith(expect.objectContaining({ container: ['shelf'] }));
  });

  it('offers no Container chips in a World that Mounts nothing — the picker exactly as it was', () => {
    const { fixture, el } = render();
    (byId(el, 'asset-link-open') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(byId(el, 'asset-link-containers')).toBeNull();
  });

  it('renders no controls for a read-only opener', () => {
    const { fixture, el } = render();
    fixture.componentInstance.disabled = true;
    fixture.componentInstance.value.set({ entityId: 'whisperwood', label: 'The Whisperwood' });
    fixture.detectChanges();

    expect(byId(el, 'asset-link-value')?.textContent).toContain('The Whisperwood');
    expect(byId(el, 'asset-link-open')).toBeNull();
    expect(byId(el, 'asset-link-clear')).toBeNull();
  });

  /**
   * The token language, in the asset picker (ADR-0082): a Facet is named inline, values and counts come
   * off the read this panel already runs, and with no rail here a filter is reversed by backspacing it.
   * `$type` answers to nothing — the read is pinned to the asset type — and says so.
   */
  describe('the token language', () => {
    beforeEach(() => {
      entities.facets.mockImplementation(() =>
        of({
          type: [],
          tag: [
            { value: 'heraldry', count: 2 },
            { value: 'draft', count: 1 },
          ],
          visibility: [],
          fields: [],
        }),
      );
    });

    function open() {
      const { fixture, el } = render();
      (byId(el, 'asset-link-open') as HTMLButtonElement).click();
      fixture.detectChanges();
      const box = byId(el, 'asset-link-search') as HTMLInputElement;
      const type = (text: string) => {
        box.value = text;
        box.setSelectionRange(text.length, text.length);
        box.dispatchEvent(new Event('input'));
        fixture.detectChanges();
      };
      return { fixture, el, type };
    }

    it('narrows by a typed Facet under the pinned asset type, then gives it back on backspace', () => {
      const { type } = open();

      type('$tag:heraldry castle');
      expect(entities.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: 'castle', tag: ['heraldry'], type: ['core.type.asset'] }),
      );

      type('castle');
      expect(entities.list).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'castle' }));
      expect(entities.list.mock.lastCall?.[0]).not.toHaveProperty('tag');
    });

    it('offers values and counts off the read it already runs, and reports a key it cannot apply', () => {
      const { el, type } = open();

      type('$tag:');
      const rows = Array.from(el.querySelectorAll('[role=option]')).map((row) =>
        (row.textContent ?? '').replace(/\s+/g, ' ').trim(),
      );
      expect(rows).toEqual(['heraldry2', 'draft1']);

      type('$type:core.type.note');
      expect(byId(el, 'asset-link-unknown-facet')?.textContent).toContain('type');
      expect(entities.list).toHaveBeenLastCalledWith(expect.objectContaining({ type: ['core.type.asset'] }));
    });
  });
});
