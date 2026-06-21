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

  it('shows no Region Subtool legend while Region is armed', () => {
    const { fixture, store } = setup();
    const id = store.createRegion('Avalon', '#b08a4e');
    store.armTool('region');
    fixture.detectChanges();

    // The Region tool joins Select/Label/Erase with no Subtools (issue #38): the old
    // legend — its New Region action, per-region rows, keycaps, paint/erase, and
    // delete — is gone (Region details now live in the Inspector, #36).
    expect(has(fixture, 'new-region')).toBe(false);
    expect(fixture.nativeElement.querySelector('.legend')).toBeNull();
    expect(has(fixture, `region-paint-${id}`)).toBe(false);
    expect(has(fixture, `region-erase-${id}`)).toBe(false);
    expect(has(fixture, `region-delete-${id}`)).toBe(false);
    expect(has(fixture, `region-name-${id}`)).toBe(false);
  });

  it('shows the no-Subtool hint while Region is armed', () => {
    const { fixture, store } = setup();
    store.armTool('region');
    fixture.detectChanges();

    // Region falls into the same no-Subtool hint branch as Select/Label/Erase.
    const hint = fixture.nativeElement.querySelector('.hint');
    expect(hint?.textContent?.trim()).toBeTruthy();
  });
});
