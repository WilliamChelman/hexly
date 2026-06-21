import { TestBed } from '@angular/core/testing';
import { EditorStore } from './editor-store';
import { RegionsPanel } from './regions-panel';

describe('RegionsPanel', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [RegionsPanel] }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(RegionsPanel);
    fixture.detectChanges();
    return fixture;
  }

  function items(el: HTMLElement) {
    return Array.from(
      el.querySelectorAll('[data-testid=region-item]'),
    ) as HTMLElement[];
  }

  it('lists every Region with its name and colour swatch, including emptied ones', () => {
    const store = TestBed.inject(EditorStore);
    // A populated Region and an emptied one (zero member hexes, so invisible on the
    // canvas) must both appear — the panel must not assume non-empty membership.
    const populated = store.createRegion('The Kingdom of Avalon', '#b08a4e');
    store.addHexToRegion(populated, { q: 0, r: 0 });
    store.createRegion('The Whisperwood', '#6f7fae'); // never painted: stays empty

    const rows = items(render().nativeElement);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('The Kingdom of Avalon'),
      expect.stringContaining('The Whisperwood'),
    ]);
    // Each row carries the Region's colour, on a swatch.
    const swatches = rows.map((row) => row.querySelector('[appSwatch]') as HTMLElement);
    expect(swatches.every((s) => s !== null)).toBe(true);
    expect(swatches[1].style.background).toContain('rgb(111, 127, 174)'); // #6f7fae
  });

  it('creates a Region through New Region, listing it without any painting', () => {
    const store = TestBed.inject(EditorStore);
    const fixture = render();

    (
      fixture.nativeElement.querySelector('[data-testid=new-region]') as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    // The fresh Region is appended to the document with no member hexes, and shows
    // up in the list as "Region 1".
    expect(store.document().regions).toHaveLength(1);
    expect(store.document().regions[0].name).toBe('Region 1');
    expect(store.document().regions[0].hexes).toEqual({});
    expect(items(fixture.nativeElement)).toHaveLength(1);
  });

  it('routes a list selection through the shared store selection, even for an empty Region', () => {
    const store = TestBed.inject(EditorStore);
    // An emptied Region — reachable only by id — proves the row goes through the
    // same store selection the canvas uses, not a coordinate click.
    const id = store.createRegion('The Whisperwood', '#6f7fae');
    store.showRegionsPanel();
    const fixture = render();

    items(fixture.nativeElement)[0].click();

    // Selecting in the list is identical to selecting on the canvas: the shared
    // store selection points at the Region, and the column flips to the Inspector.
    expect(store.selection()).toEqual({ kind: 'region', id });
    expect(store.selectedRegion()?.name).toBe('The Whisperwood');
    expect(store.rightPanel()).toBe('inspector');
  });
});
