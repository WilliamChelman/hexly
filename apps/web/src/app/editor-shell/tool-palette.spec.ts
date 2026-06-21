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

    click(fixture, 'tool-label');
    expect(store.tool()).toBe('label');

    click(fixture, 'tool-erase');
    expect(store.tool()).toBe('erase');

    click(fixture, 'tool-select');
    expect(store.tool()).toBe('select');
  });

  it('offers no Region tool — Regions are created and edited elsewhere', () => {
    const { fixture } = setup();

    // Region left the palette (ADR-0012): creation is the Regions panel's New Region,
    // and membership is painted via the Inspector's Add/Remove. There is no Region
    // button (and no `R` hotkey) to arm `region` from the palette.
    expect(has(fixture, 'tool-region')).toBe(false);
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

describe('ToolPalette history', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ToolPalette] }).compileComponents();
  });

  it('renders Undo and Redo, disabled when there is nothing to undo or redo', () => {
    const { fixture, store } = setup();
    const undo = () =>
      fixture.nativeElement.querySelector('[data-testid=undo]') as HTMLButtonElement;
    const redo = () =>
      fixture.nativeElement.querySelector('[data-testid=redo]') as HTMLButtonElement;

    // The history controls live at the bottom of the strip (story 13).
    expect(undo()).not.toBeNull();
    expect(redo()).not.toBeNull();

    // A fresh map has nothing to undo or redo, so both are disabled (story 14).
    expect(undo().disabled).toBe(true);
    expect(redo().disabled).toBe(true);

    // An edit enables Undo but not yet Redo.
    store.paintAt({ q: 0, r: 0 }, 'forest');
    fixture.detectChanges();
    expect(undo().disabled).toBe(false);
    expect(redo().disabled).toBe(true);
  });

  it('drives the store history when Undo and Redo are clicked', () => {
    const { fixture, store } = setup();
    store.paintAt({ q: 0, r: 0 }, 'forest');

    click(fixture, 'undo');
    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(true);

    click(fixture, 'redo');
    expect(store.document().hexes['0,0']).toEqual({ terrain: 'forest' });
  });
});

describe('ToolPalette regions', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ToolPalette] }).compileComponents();
  });

  it('shows no Region Subtool legend while the Region brush is armed', () => {
    const { fixture, store } = setup();
    const id = store.createRegion('Avalon', '#b08a4e');
    store.armTool('region'); // the internal brush state the Inspector arms (ADR-0012)
    fixture.detectChanges();

    // The Region brush has no Subtools and no legend (issue #38, ADR-0012): the old
    // legend — its New Region action, per-region rows, keycaps, paint/erase, and
    // delete — is gone (Region details live in the Inspector, #36; creation in the
    // Regions panel, #39).
    expect(has(fixture, 'new-region')).toBe(false);
    expect(fixture.nativeElement.querySelector('.legend')).toBeNull();
    expect(has(fixture, `region-paint-${id}`)).toBe(false);
    expect(has(fixture, `region-erase-${id}`)).toBe(false);
    expect(has(fixture, `region-delete-${id}`)).toBe(false);
    expect(has(fixture, `region-name-${id}`)).toBe(false);
  });

  it('highlights no Tool and shows no flyout while the Region brush is armed', () => {
    const { fixture, store } = setup();
    store.createRegion('Avalon', '#b08a4e');
    store.armTool('region'); // the internal brush state the Inspector arms (ADR-0012)
    fixture.detectChanges();

    // Story 25: while the membership brush is armed the active affordance is the
    // Inspector's Add/Remove, so the strip highlights no Tool and opens no flyout.
    expect(fixture.nativeElement.querySelector('.flyout')).toBeNull();
    expect(fixture.nativeElement.querySelector('button.is-active')).toBeNull();
  });
});

describe('ToolPalette flyout binding', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ToolPalette] }).compileComponents();
  });

  it('opens no flyout for Select, Label, or Erase (no Subtools)', () => {
    const { fixture, store } = setup();

    for (const tool of ['select', 'label', 'erase'] as const) {
      store.armTool(tool);
      fixture.detectChanges();
      // Tools without Subtools render no flyout at all, keeping the map clear (story 10).
      expect(fixture.nativeElement.querySelector('.flyout')).toBeNull();
    }
  });

  it('opens a flyout bound to the armed painting Tool', () => {
    const { fixture, store } = setup();

    store.armTool('terrain');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.flyout')).not.toBeNull();

    store.armTool('feature');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.flyout')).not.toBeNull();
  });
});
