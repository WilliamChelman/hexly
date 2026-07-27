import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import {
  WORLD_THEME_VERSION,
  WorldDetail,
  WorldTheme,
  WorldThemeInput,
  WorldThemeSource,
  colorTokenHex,
} from '@hexly/domain';
import { ActiveWorld, INSTANCE_THEME, WorldThemeLayer, WorldsClient } from '@hexly/web-core';
import { designTokenInitial } from '@hexly/web-styles';
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

  /**
   * The tier-2 opt-outs (#374). The pure helpers own the folding; what this asserts is the round trip
   * through the DOM an Owner actually drives — and that clearing sends an *absence*.
   */
  describe('overriding an individual token', () => {
    /** Turn an untouched row into an override, then move the control it put there. */
    function override(fixture: ComponentFixture<WorldThemePanelComponent>, key: string, value: string): void {
      at(fixture, `theme-override-set-solar-${key}`).click();
      fixture.detectChanges();
      const control = at(fixture, `theme-override-solar-${key}`) as HTMLInputElement;
      control.value = value;
      control.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    }

    it('offers a control per public role, and none for a private anchor or a plugin’s vocabulary', () => {
      const fixture = mount(null);

      expect(at(fixture, 'theme-override-set-solar-color-ink-muted')).toBeTruthy();
      expect(at(fixture, 'theme-override-set-astral-color-ink-muted')).toBeTruthy();
      expect(at(fixture, 'theme-override-set-solar-shadow-2')).toBeTruthy();
      // ADR-0075's tier boundary: the anchors are authored as the Palette, and tier 3 is not ours.
      expect(at(fixture, 'theme-override-set-solar-palette-accent')).toBeNull();
      expect(at(fixture, 'theme-override-set-solar-color-terrain-grass')).toBeNull();
    });

    /**
     * The row shows what the token *is*, not a word for where it came from: "derived" was untrue of
     * `--color-canvas-glow`, a named literal, and of the seven roles that are a tier-1 anchor under
     * another name (ADR-0075). jsdom resolves no derivation, so what it shows here is the manifest's
     * own value — which is the fallback, and still the token's value rather than its provenance.
     */
    it('shows an untouched row as the value it renders as, in both ColorSchemes', () => {
      const fixture = mount(null);

      for (const scheme of ['solar', 'astral']) {
        const cell = at(fixture, `theme-override-set-${scheme}-color-canvas-glow`);
        expect(cell.textContent?.trim()).toBe(colorTokenHex(designTokenInitial('--color-canvas-glow')));
        expect(cell.getAttribute('aria-label')).toContain(designTokenInitial('--color-canvas-glow'));
      }
    });

    it('seeds a new override at that same value, so opting a token out changes nothing on screen', () => {
      const fixture = mount(null);

      at(fixture, 'theme-override-set-astral-color-canvas-glow').click();
      fixture.detectChanges();

      // Seeded verbatim rather than through the hex, which would drop this role's 0.55 alpha. The
      // ColorScheme the reader is not in is seeded from its own measurement now, not from the root.
      expect(save(fixture)?.overrides?.astral?.['--color-canvas-glow']).toBe(designTokenInitial('--color-canvas-glow'));
    });

    it('sends the override per ColorScheme, alongside a Palette it materialised whole', () => {
      const fixture = mount(instance);
      override(fixture, 'color-ink-muted', '#112233');

      const sent = save(fixture);

      expect(sent?.overrides).toEqual({ solar: { '--color-ink-muted': '#112233' } });
      // A first edit is still a whole Theme, and the operator's branding survives it (#371 × #372).
      expect(sent?.solar.accent).toBe(OPERATOR_ACCENT);
    });

    it('clears by sending no key at all, so the token goes back to what the anchors derive', () => {
      const fixture = mount(null);
      override(fixture, 'color-ink-muted', '#112233');

      at(fixture, 'theme-override-clear-solar-color-ink-muted').click();
      fixture.detectChanges();

      // Not an empty string and not the derived value written down: the applier takes back what a
      // previous write set and this one does not (ADR-0076), so an absent key *is* the derivation.
      expect(save(fixture)?.overrides).toBeUndefined();
      expect(at(fixture, 'theme-override-set-solar-color-ink-muted')).toBeTruthy();
    });

    it('leaves an emptied field alone, so retyping a shadow does not take the field away', () => {
      const fixture = mount(null);
      override(fixture, 'shadow-2', '0 8px 20px rgba(0, 0, 0, 0.5)');

      const field = at(fixture, 'theme-override-solar-shadow-2') as HTMLInputElement;
      field.value = '';
      field.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      // Still an override, still a field: an empty string is no value of any token's type, and clearing
      // is the ✕ — as `withControlValue` leaves an emptied knob at what it held.
      expect(at(fixture, 'theme-override-solar-shadow-2')).toBeTruthy();
      expect(save(fixture)?.overrides?.solar?.['--shadow-2']).toBe('0 8px 20px rgba(0, 0, 0, 0.5)');
    });

    it('reads an override set then cleared as no change at all', () => {
      const fixture = mount(null, stored());
      override(fixture, 'color-ink-muted', '#112233');
      expect((at(fixture, 'theme-save') as HTMLButtonElement).disabled).toBe(false);

      at(fixture, 'theme-override-clear-solar-color-ink-muted').click();
      fixture.detectChanges();

      expect((at(fixture, 'theme-save') as HTMLButtonElement).disabled).toBe(true);
    });

    it('leaves an overridden token at its override when the Palette is re-anchored', () => {
      // The criterion that proves an override sits *after* the derivation rather than beside it: the
      // anchor moves, every derived role moves with it, and the opt-out does not.
      const fixture = mount(null);
      override(fixture, 'color-ink-muted', '#112233');

      move(fixture, 'accent', '#6a2ab0');
      const sent = save(fixture);

      expect(sent?.solar.accent).toBe('#6a2ab0');
      expect(sent?.overrides).toEqual({ solar: { '--color-ink-muted': '#112233' } });
    });
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

  /**
   * Copying another World's Theme in (#376). The offer itself is the server's; what this asserts is
   * what the editor does with it — a copy **stages**, so it previews, it cancels, and it commits
   * through the one save every other edit rides.
   */
  describe('copying from another World', () => {
    /** A source World's whole Theme, told apart from {@link stored} in every part the copy must carry. */
    function sourceTheme(): WorldTheme {
      const from = stored();
      return {
        ...from,
        solar: { ...from.solar, accent: 'oklch(0.7 0.2 300)' },
        radii: RADIUS_PRESETS[0].radii,
        fontPairing: 'codex',
        overrides: { solar: { '--color-ink-muted': 'oklch(0.5 0.02 90)' } },
      };
    }

    const offer = (theme: WorldTheme): WorldThemeSource[] => [{ id: 'w2', name: 'Whisperwood', theme }];

    it('stages the source World’s values whole, so they preview and can still be cancelled', () => {
      worlds.themeSources.mockReturnValue(of(offer(sourceTheme())));
      const fixture = mount(null, stored());

      at(fixture, 'theme-copy').click();
      fixture.detectChanges();

      // Staged, not applied: nothing was written, and the panel reads as carrying unsaved work.
      expect(worlds.setTheme).not.toHaveBeenCalled();
      expect(at(fixture, 'theme-unsaved')).toBeTruthy();
      expect((at(fixture, 'theme-control-solar-accent') as HTMLInputElement).value).toBe(
        colorTokenHex('oklch(0.7 0.2 300)'),
      );

      // And cancel is still cancel — a copy an Owner previews and thinks better of costs nothing.
      at(fixture, 'theme-discard').click();
      fixture.detectChanges();
      expect((at(fixture, 'theme-control-solar-accent') as HTMLInputElement).value).toBe(
        colorTokenHex(stored().solar.accent),
      );
    });

    it('sends the copy through the one save, as this World’s own values', () => {
      worlds.themeSources.mockReturnValue(of(offer(sourceTheme())));
      const fixture = mount(null, stored());

      at(fixture, 'theme-copy').click();
      fixture.detectChanges();
      const sent = save(fixture);

      // Every part of the contract comes over, not the anchors alone — a copy that dropped the
      // pairing or the opt-outs would hand the Owner a Theme that is not the one they picked.
      expect(sent).toEqual({ ...sourceTheme(), version: WORLD_THEME_VERSION });
      // And it goes out stamped with the version this build knows, through the one PATCH.
      expect(worlds.setTheme).toHaveBeenCalledWith('w1', sent);
    });

    it('leaves the copy editable, and an edit disturbs nothing else in it', () => {
      worlds.themeSources.mockReturnValue(of(offer(sourceTheme())));
      const fixture = mount(null);

      at(fixture, 'theme-copy').click();
      fixture.detectChanges();
      move(fixture, 'ink', '#112233');

      const sent = save(fixture);
      expect(sent?.solar.ink).toBe('#112233');
      expect(sent?.solar.accent).toBe('oklch(0.7 0.2 300)');
    });

    it('offers only what the server handed over, and says so plainly when that is nothing', () => {
      // The picker never filters: an empty offer is the server's answer that this Owner has no other
      // themed World, which is why it reads as an empty state rather than an empty dropdown (#376).
      const fixture = mount(null);

      expect(at(fixture, 'theme-copy-empty')).toBeTruthy();
      expect(at(fixture, 'theme-copy')).toBeNull();
      expect(worlds.themeSources).toHaveBeenCalledWith('w1');
    });
  });
});
