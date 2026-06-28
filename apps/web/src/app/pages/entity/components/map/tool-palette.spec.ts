import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { provideTranslocoTesting } from '../../../../core/i18n/transloco-testing';
import { HexMapStore } from '../../services/hexmap-store';
import { ToolPalette } from './tool-palette';

function setup() {
  const fixture = TestBed.createComponent(ToolPalette);
  const store = TestBed.inject(HexMapStore);
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
    await TestBed.configureTestingModule({ imports: [ToolPalette, provideTranslocoTesting()] }).compileComponents();
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
    await TestBed.configureTestingModule({ imports: [ToolPalette, provideTranslocoTesting()] }).compileComponents();
  });

  it('shows the Select Subtools Pick and Marquee, with Pick active at cold-start', () => {
    const { fixture } = setup();

    // A fresh map boots in Select, which now has two Subtools (ADR-0017): the
    // flyout shows Pick and Marquee, with Pick (the boot default) active.
    expect(has(fixture, 'select-pick')).toBe(true);
    expect(has(fixture, 'select-marquee')).toBe(true);
    const pick = fixture.nativeElement.querySelector(
      '[data-testid=select-pick]',
    ) as HTMLButtonElement;
    expect(pick.classList.contains('is-active')).toBe(true);
    // The painting Tools' Subtools stay scoped to their own flyouts.
    expect(has(fixture, 'feature-settlement')).toBe(false);
    expect(fixture.nativeElement.querySelector('[aria-label=Ocean]')).toBeNull();
  });

  it('arms the Pick and Marquee Subtools from the Select flyout', () => {
    const { fixture, store } = setup();

    click(fixture, 'select-marquee');
    expect(store.tool()).toBe('select');
    expect(store.selectSubtool()).toBe('marquee');

    click(fixture, 'select-pick');
    expect(store.selectSubtool()).toBe('pick');
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
    await TestBed.configureTestingModule({ imports: [ToolPalette, provideTranslocoTesting()] }).compileComponents();
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
    await TestBed.configureTestingModule({ imports: [ToolPalette, provideTranslocoTesting()] }).compileComponents();
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
    await TestBed.configureTestingModule({ imports: [ToolPalette, provideTranslocoTesting()] }).compileComponents();
  });

  it('opens no flyout for Label or Erase (no Subtools)', () => {
    const { fixture, store } = setup();

    for (const tool of ['label', 'erase'] as const) {
      store.armTool(tool);
      fixture.detectChanges();
      // Tools without Subtools render no flyout at all, keeping the map clear (story 10).
      expect(fixture.nativeElement.querySelector('.flyout')).toBeNull();
    }
  });

  it('opens a flyout bound to the armed Tool — Select, Terrain, and Feature', () => {
    const { fixture, store } = setup();

    // Select now carries Pick/Marquee Subtools, so it opens a flyout too (ADR-0017).
    store.armTool('select');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.flyout')).not.toBeNull();

    store.armTool('terrain');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.flyout')).not.toBeNull();

    store.armTool('feature');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.flyout')).not.toBeNull();
  });
});

describe('ToolPalette localization', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ToolPalette, provideTranslocoTesting()],
    }).compileComponents();
  });

  it('names the top-level Tools in French when French is the active language', () => {
    const { fixture } = setup();
    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    // Each Tool button carries its name on aria-label; the built-in catalog and
    // tool names reflow live on a switch (ADR-0014).
    const labelOf = (testid: string) =>
      (
        fixture.nativeElement.querySelector(
          `[data-testid=${testid}]`,
        ) as HTMLElement
      ).getAttribute('aria-label');
    expect(labelOf('tool-select')).toBe('Sélection');
    expect(labelOf('tool-feature')).toBe('Caractéristique');
    expect(labelOf('tool-erase')).toBe('Effacer');
  });

  it('names the built-in terrains and features in French via their stable id', () => {
    const { fixture, store } = setup();
    TestBed.inject(TranslocoService).setActiveLang('fr');

    // Terrain swatches render under the Terrain tool; their aria-label is keyed
    // by id (domain.terrain.ocean), not the English domain label.
    store.armTool('terrain');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[aria-label=Océan]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[aria-label=Ocean]')).toBeNull();

    // Feature icons likewise key by id (domain.feature.settlement → Colonie).
    store.armTool('feature');
    fixture.detectChanges();
    const settlement = fixture.nativeElement.querySelector(
      '[data-testid=feature-settlement]',
    ) as HTMLElement;
    expect(settlement.getAttribute('aria-label')).toBe('Colonie');
  });
});
