import { TestBed } from '@angular/core/testing';
import { EditorStore } from './editor-store';
import { ToolPalette } from './tool-palette';

function setup() {
  const fixture = TestBed.createComponent(ToolPalette);
  const store = TestBed.inject(EditorStore);
  fixture.detectChanges();
  return { fixture, store };
}

/** Click the element with `data-testid`, re-rendering first so it is in the DOM. */
function click(
  fixture: ReturnType<typeof TestBed.createComponent>,
  testid: string,
): void {
  fixture.detectChanges();
  const el = fixture.nativeElement.querySelector(
    `[data-testid=${testid}]`,
  ) as HTMLButtonElement | null;
  if (!el) throw new Error(`no element with data-testid="${testid}"`);
  el.click();
  fixture.detectChanges();
}

function has(
  fixture: ReturnType<typeof TestBed.createComponent>,
  testid: string,
): boolean {
  fixture.detectChanges();
  return !!fixture.nativeElement.querySelector(`[data-testid=${testid}]`);
}

describe('ToolPalette primary Tool row', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ToolPalette] }).compileComponents();
  });

  it('arms each top-level Tool from the primary row', () => {
    const { fixture, store } = setup();

    click(fixture, 'tool-terrain');
    expect(store.tool()).toBe('terrain');

    click(fixture, 'tool-feature');
    expect(store.tool()).toBe('feature');

    click(fixture, 'tool-region');
    expect(store.tool()).toBe('region');

    click(fixture, 'tool-label');
    expect(store.tool()).toBe('label');

    click(fixture, 'tool-erase');
    expect(store.tool()).toBe('erase');

    click(fixture, 'tool-select');
    expect(store.tool()).toBe('select');
  });
});

describe('ToolPalette contextual Subtool panel', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ToolPalette] }).compileComponents();
  });

  it('shows no Subtool strip while Select is armed (the cold-start tool)', () => {
    const { fixture } = setup();

    // A fresh map boots in Select, which has no Subtools (CONTEXT.md → Subtool).
    // The terrain swatch buttons (e.g. "Ocean") only render under the Terrain
    // tool — querying for one avoids colliding with the primary Terrain button.
    expect(has(fixture, 'feature-settlement')).toBe(false);
    expect(fixture.nativeElement.querySelector('[aria-label=Ocean]')).toBeNull();
  });

  it('shows terrain swatches and arms a terrain when Terrain is armed', () => {
    const { fixture, store } = setup();
    store.armTool('terrain');

    fixture.detectChanges();
    const ocean = fixture.nativeElement.querySelector(
      '[aria-label=Ocean]',
    ) as HTMLButtonElement;
    ocean.click();

    expect(store.tool()).toBe('terrain');
    expect(store.terrain()).toBe('ocean');
  });

  it('shows feature icons and Clear, and arms them, when Feature is armed', () => {
    const { fixture, store } = setup();
    store.armTool('feature');

    click(fixture, 'feature-settlement');
    expect(store.feature()).toBe('settlement');

    click(fixture, 'clear-feature');
    expect(store.feature()).toBe('clear');
  });

  it('shows no feature strip while Feature is not armed', () => {
    const { fixture } = setup();

    expect(has(fixture, 'feature-settlement')).toBe(false);
    expect(has(fixture, 'clear-feature')).toBe(false);
  });
});

describe('ToolPalette regions', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ToolPalette] }).compileComponents();
  });

  it('shows the region legend only while Region is armed', () => {
    const { fixture, store } = setup();
    store.createRegion('Avalon', '#b08a4e');

    // Region is not armed yet → no legend.
    expect(has(fixture, 'new-region')).toBe(false);

    store.armTool('region');
    expect(has(fixture, 'new-region')).toBe(true);
  });

  it('shows a number keycap per region mirroring the keyboard Subtool index', () => {
    const { fixture, store } = setup();
    store.createRegion('Avalon', '#b08a4e');
    store.armTool('region');
    fixture.detectChanges();

    // The legend's first region carries the '1' keycap that armSubtoolByIndex(1)
    // maps to, so the keyboard binding is discoverable (issue #27).
    const kbd = fixture.nativeElement.querySelector('.legend kbd');
    expect(kbd?.textContent?.trim()).toBe('1');
  });

  it('creates a region and arms it for painting when New region is clicked', () => {
    const { fixture, store } = setup();
    store.armTool('region');

    click(fixture, 'new-region');

    const regions = store.document().regions;
    expect(regions).toHaveLength(1);
    expect(store.tool()).toBe('region');
    expect(store.region()).toEqual({ id: regions[0].id, mode: 'add' });
  });

  it('lists each region in the document by name', () => {
    const { fixture, store } = setup();
    store.createRegion('The Whisperwood', '#7c9b86');
    store.armTool('region');
    fixture.detectChanges();

    const id = store.document().regions[0].id;
    const nameInput = fixture.nativeElement.querySelector(
      `[data-testid=region-name-${id}]`,
    ) as HTMLInputElement;
    expect(nameInput.value).toBe('The Whisperwood');
  });

  it('arms the erase brush for a region when its Erase is clicked', () => {
    const { fixture, store } = setup();
    const id = store.createRegion('Avalon', '#b08a4e');
    store.armTool('region');

    click(fixture, `region-erase-${id}`);

    expect(store.region()).toEqual({ id, mode: 'remove' });
  });

  it('renames a region when its name field changes', () => {
    const { fixture, store } = setup();
    const id = store.createRegion('Avalon', '#b08a4e');
    store.armTool('region');
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector(
      `[data-testid=region-name-${id}]`,
    ) as HTMLInputElement;
    input.value = 'The Kingdom of Avalon';
    input.dispatchEvent(new Event('change'));

    expect(store.document().regions[0].name).toBe('The Kingdom of Avalon');
  });

  it('recolors a region when its color field changes', () => {
    const { fixture, store } = setup();
    const id = store.createRegion('Avalon', '#b08a4e');
    store.armTool('region');
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector(
      `[data-testid=region-color-${id}]`,
    ) as HTMLInputElement;
    input.value = '#6f7fae';
    input.dispatchEvent(new Event('change'));

    expect(store.document().regions[0].color).toBe('#6f7fae');
  });

  it('deletes a region when its delete control is clicked', () => {
    const { fixture, store } = setup();
    const id = store.createRegion('Avalon', '#b08a4e');
    store.armTool('region');

    click(fixture, `region-delete-${id}`);

    expect(store.document().regions).toEqual([]);
  });

  it('clears the selection when the deleted region was the selected one', () => {
    const { fixture, store } = setup();
    const id = store.createRegion('Avalon', '#b08a4e');
    store.addHexToRegion(id, { q: 0, r: 0 });
    store.select({ q: 0, r: 0 }, null); // the only candidate there: the Region
    store.armTool('region'); // render the regions legend (and its Delete control)
    expect(store.selection()).toEqual({ kind: 'region', id });

    click(fixture, `region-delete-${id}`);

    expect(store.document().regions).toEqual([]);
    expect(store.selection()).toBeNull();
  });
});
