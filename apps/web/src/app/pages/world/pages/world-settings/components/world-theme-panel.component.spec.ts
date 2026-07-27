import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { WORLD_THEME_VERSION, WorldDetail, WorldTheme, WorldThemeInput, colorTokenHex } from '@hexly/domain';
import { ActiveWorld, INSTANCE_THEME, WorldThemeLayer, WorldsClient } from '@hexly/web-core';
import { MockWorldsClient } from '@hexly/web-core/testing';
import { provideTranslocoTesting } from '../../../../../../testing/transloco-testing';
import { PALETTE_CONTROLS, RADIUS_PRESETS } from '../utils/theme-draft';
import { WorldThemePanelComponent } from './world-theme-panel.component';

/** The World Theme editor: what it opens an unthemed World at, and what a save actually sends. */
describe('WorldThemePanel', () => {
  const OPERATOR_ACCENT = 'oklch(0.6 0.2 300)';

  /** An operator branding one anchor of one ColorScheme — the layer is partial by design (#372). */
  const instance: WorldThemeLayer = { solar: { accent: OPERATOR_ACCENT } };

  let worlds: MockWorldsClient;

  /** A World that already carries a Theme, so a reset has something to clear. */
  function stored(): WorldTheme {
    const palette = Object.fromEntries(
      PALETTE_CONTROLS.map((control) => [control.field, control.type === 'number' ? 0.3 : 'oklch(0.5 0.1 40)']),
    ) as WorldTheme['solar'];
    return { version: WORLD_THEME_VERSION, solar: palette, astral: palette };
  }

  function mount(layer: WorldThemeLayer | null, stored?: WorldTheme): ComponentFixture<WorldThemePanelComponent> {
    TestBed.configureTestingModule({
      imports: [WorldThemePanelComponent, provideTranslocoTesting()],
      providers: [
        { provide: WorldsClient, useValue: worlds },
        { provide: INSTANCE_THEME, useValue: layer },
      ],
    });
    TestBed.inject(ActiveWorld).set(
      stored ? ({ id: 'w1', name: 'Aldermoor', theme: stored } as WorldDetail) : 'w1',
      'w1',
    );
    const fixture = TestBed.createComponent(WorldThemePanelComponent);
    fixture.componentRef.setInput('id', 'w1');
    fixture.detectChanges();
    return fixture;
  }

  const at = (fixture: ComponentFixture<WorldThemePanelComponent>, testid: string): HTMLElement =>
    fixture.nativeElement.querySelector(`[data-testid="${testid}"]`);

  /** Move one Solar control through the DOM, exactly as an Owner does. */
  function move(fixture: ComponentFixture<WorldThemePanelComponent>, field: string, value: string): void {
    const control = at(fixture, `theme-control-solar-${field}`) as HTMLInputElement;
    control.value = value;
    control.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  /** Press Save and hand back what the client was asked to store. */
  function save(fixture: ComponentFixture<WorldThemePanelComponent>): WorldThemeInput | null {
    at(fixture, 'theme-save').click();
    fixture.detectChanges();
    return worlds.setTheme.mock.calls.at(-1)?.[1] ?? null;
  }

  beforeEach(() => {
    worlds = new MockWorldsClient();
    worlds.setTheme.mockImplementation(() => of({ id: 'w1', name: 'Aldermoor' } as WorldDetail));
  });

  it('opens an unthemed World on the operator’s branding, not on the stylesheet under it', () => {
    const fixture = mount(instance);

    // The colour control speaks hex, so the operator's OKLCH arrives converted rather than verbatim.
    expect((at(fixture, 'theme-control-solar-accent') as HTMLInputElement).value).toBe(colorTokenHex(OPERATOR_ACCENT));
  });

  it('keeps the operator’s branding on every anchor an Owner did not move', () => {
    // The regression guard (#371 × #372). A stored Theme carries both Palettes entire, so a first edit
    // materialises all eleven anchors; seeded from the stylesheet they would overwrite the operator's.
    const fixture = mount(instance);
    move(fixture, 'ink', '#112233');

    const sent = save(fixture);

    expect(sent?.solar.ink).toBe('#112233');
    expect(sent?.solar.accent).toBe(OPERATOR_ACCENT);
  });

  it('sends every anchor, so an Owner’s Theme is whole rather than a patch', () => {
    const fixture = mount(null);
    move(fixture, 'ink', '#112233');

    expect(Object.keys(save(fixture)?.solar ?? {}).sort()).toEqual(PALETTE_CONTROLS.map((c) => c.field).sort());
  });

  it('clears a stored World Theme when a staged reset is saved', () => {
    const fixture = mount(instance, stored());

    at(fixture, 'theme-reset').click();
    fixture.detectChanges();

    expect(save(fixture)).toBeNull();
    expect(worlds.setTheme).toHaveBeenCalledWith('w1', null);
  });

  it('offers nothing to save when a reset would change nothing — the World already carries none', () => {
    const fixture = mount(instance);

    expect((at(fixture, 'theme-reset') as HTMLButtonElement).disabled).toBe(true);
    expect((at(fixture, 'theme-save') as HTMLButtonElement).disabled).toBe(true);
  });

  /** The non-colour half (#375): a corner-radius set and a font pairing, each picked whole. */
  describe('the corner-radius set and the font pairing', () => {
    const pick = (fixture: ComponentFixture<WorldThemePanelComponent>, testid: string): void => {
      at(fixture, testid).click();
      fixture.detectChanges();
    };

    const sharp = RADIUS_PRESETS.find((preset) => preset.id === 'sharp')!.radii;

    it('sends the picked set’s five values, alongside the Palette a first edit materialises', () => {
      const fixture = mount(null);

      pick(fixture, 'theme-radii-sharp');

      expect(save(fixture)?.radii).toEqual(sharp);
    });

    it('stores no set at all for the Hexly default — that is what a World wearing it carries', () => {
      const fixture = mount(null, { ...stored(), radii: sharp });

      pick(fixture, 'theme-radii-default');

      expect(save(fixture)?.radii).toBeUndefined();
    });

    it('leaves a World carrying no Theme carrying none when the default is what was picked', () => {
      const fixture = mount(null);

      // Dispatched rather than clicked: a checked radio emits nothing, and the invariant being held
      // here is the handler's — picking what a World already wears must not stage a whole Theme.
      at(fixture, 'theme-radii-default').dispatchEvent(new Event('change'));
      at(fixture, 'theme-font-default').dispatchEvent(new Event('change'));
      fixture.detectChanges();

      expect((at(fixture, 'theme-save') as HTMLButtonElement).disabled).toBe(true);
    });

    it('shows both defaults as picked on a World that sets neither — an absence is still a choice', () => {
      const fixture = mount(null);

      expect((at(fixture, 'theme-radii-default') as HTMLInputElement).checked).toBe(true);
      expect((at(fixture, 'theme-font-default') as HTMLInputElement).checked).toBe(true);
    });

    it('opens on the set and the pairing the World stored, not on the default', () => {
      const fixture = mount(null, { ...stored(), radii: sharp, fontPairing: 'codex' });

      expect((at(fixture, 'theme-radii-sharp') as HTMLInputElement).checked).toBe(true);
      expect((at(fixture, 'theme-font-codex') as HTMLInputElement).checked).toBe(true);
    });

    it('says so when a World carries a set no offered one matches, rather than showing a wrong one', () => {
      // The schema takes any set of the five (ADR-0076), so one authored over the API is legitimate.
      const fixture = mount(null, { ...stored(), radii: { '--radius-md': '4px' } });

      expect(at(fixture, 'theme-radii-custom')).toBeTruthy();
    });

    it('sends the picked pairing, and leaves the set the World already carried alone', () => {
      const fixture = mount(null, { ...stored(), radii: sharp });

      pick(fixture, 'theme-font-codex');

      const sent = save(fixture);
      expect(sent?.fontPairing).toBe('codex');
      expect(sent?.radii).toEqual(sharp);
    });
  });
});
