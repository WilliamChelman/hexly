import { provideTranslocoTesting } from '../../../testing/transloco-testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { terrainSet } from '@hexly/plugin-hexmap';
import { PALETTE_PRESETS, PALETTE_PRESET_IDS, PALETTE_TOKENS } from '@hexly/domain';
import { StyleguidePage } from './styleguide.page';

describe('Styleguide', () => {
  function render() {
    TestBed.configureTestingModule({
      imports: [StyleguidePage, provideTranslocoTesting()],
      providers: [provideRouter([])],
    });
    const fixture = TestBed.createComponent(StyleguidePage);
    fixture.detectChanges();
    return fixture;
  }

  /**
   * What an engine reads back for a value it was given — the Preset table authors notations and the
   * style object answers in its own, so both sides of an assertion go through the same parse.
   */
  function readBack(property: 'background' | 'color', value: string): string {
    const probe = document.createElement('span');
    probe.style.setProperty(property, value);
    return probe.style.getPropertyValue(property);
  }

  /** Flip the active language and run change detection so the view reflows. */
  function switchTo(fixture: ReturnType<typeof render>, lang: string) {
    TestBed.inject(TranslocoService).setActiveLang(lang);
    fixture.detectChanges();
  }

  it('renders its masthead in French when French is the active language', () => {
    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;

    switchTo(fixture, 'fr');

    const guide = el.querySelector('.guide-top') as HTMLElement;
    expect(guide.textContent).toContain('Retour aux mondes');
    expect(guide.textContent).not.toContain('Back to worlds');

    const hero = el.querySelector('.hero') as HTMLElement;
    expect(hero.textContent).toContain('table du cartographe');
    expect(hero.textContent).not.toContain('cartographer’s table');
  });

  it('renders swatch display names from keys, localized to the active language', () => {
    const fixture = render();
    const swatches = () =>
      Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.swatches'))
        .map((el) => el.textContent)
        .join(' ');

    // English default resolves the token-display labels.
    expect(swatches()).toContain('Compass gold');
    expect(swatches()).toContain('Grassland');

    switchTo(fixture, 'fr');

    expect(swatches()).toContain('Or de boussole');
    expect(swatches()).toContain('Prairie');
    expect(swatches()).not.toContain('Compass gold');
  });

  it('swatches the terrain the hexmap plugin actually paints with, in its order', () => {
    // The page may name another plugin's tier-3 tokens (ADR-0075), but nothing held the list to the
    // set it mirrors — which is how a marsh swatch outlived the terrain it painted.
    const el = render().nativeElement as HTMLElement;

    const rendered = Array.from(el.querySelectorAll('.swatchcard code'), (code) => code.textContent?.trim());

    expect(rendered.filter((token) => token?.startsWith('--color-terrain-'))).toEqual(terrainSet.map((t) => t.fill));
  });

  it('renders section titles and component-example copy from keys, localized', () => {
    const fixture = render();
    const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

    // English default: section titles and specimen labels resolve.
    expect(text()).toContain('Components');
    expect(text()).toContain('Share map');
    expect(text()).toContain('Type scale');

    switchTo(fixture, 'fr');

    // Section titles and notes.
    expect(text()).toContain('Composants');
    expect(text()).toContain('Échelle typographique');
    expect(text()).toContain('rôles sémantiques');
    // Specimen captions and example labels.
    expect(text()).toContain('Boutons');
    expect(text()).toContain('Champs');
    expect(text()).toContain('Partager la carte');
    // The English copy is fully gone.
    expect(text()).not.toContain('Components');
    expect(text()).not.toContain('Share map');
    expect(text()).not.toContain('Type scale');
  });

  it('preserves the masthead lede’s inline markup while localizing it', () => {
    const fixture = render();
    const lede = () => (fixture.nativeElement as HTMLElement).querySelector('.hero-lede') as HTMLElement;

    // The emphasis/code markup survives the move into a single key.
    expect(lede().querySelector('strong')).not.toBeNull();
    expect(lede().querySelector('code')?.textContent).toBe('apps/web');
    expect(lede().textContent).toContain('One identity');

    switchTo(fixture, 'fr');

    expect(lede().textContent).toContain('Une seule identité');
    expect(lede().textContent).not.toContain('One identity');
    // The prose moves and the Preset it names does not: Solar is a proper noun (ADR-0077).
    expect(lede().querySelector('strong')?.textContent).toBe('Solar');
  });

  it('galleries every Palette Preset the table offers, in that Preset’s own Anchors', () => {
    // Read off `PALETTE_PRESETS` rather than a list here, which is the property under test: a Preset
    // added to the table has to reach the gallery with no edit to the styleguide (ADR-0077).
    const el = render().nativeElement as HTMLElement;

    for (const id of PALETTE_PRESET_IDS) {
      const preset = PALETTE_PRESETS[id];
      const card = el.querySelector(`[data-testid="styleguide-preset-${id}"]`) as HTMLElement;
      expect(card).not.toBeNull();

      // Painted in its own colours, not in the reader's active Palette.
      expect(card.style.background).toBe(readBack('background', preset.values.page));
      expect(card.style.color).toBe(readBack('color', preset.values.ink));

      // The eight Anchors, each named by the tier-1 token it writes; the three knobs are numbers the
      // derivation turns rather than colours to show.
      const anchors = Object.entries(PALETTE_TOKENS).filter(
        ([field]) => typeof preset.values[field as keyof typeof preset.values] === 'string',
      );
      const chips = Array.from(card.querySelectorAll('.anchor-chip')) as HTMLElement[];
      expect(chips.map((chip) => chip.dataset['token'])).toEqual(anchors.map(([, token]) => token));
      expect(chips.map((chip) => chip.style.background)).toEqual(
        anchors.map(([field]) => readBack('background', String(preset.values[field as keyof typeof preset.values]))),
      );
    }
  });

  it('names each Preset identically whatever the locale, and localizes its description', () => {
    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;
    const part = (id: string, selector: string) =>
      (el.querySelector(`[data-testid="styleguide-preset-${id}"] ${selector}`) as HTMLElement).textContent?.trim();
    const names = () => PALETTE_PRESET_IDS.map((id) => part(id, '.presetcard-name'));
    const hints = () => PALETTE_PRESET_IDS.map((id) => part(id, '.presetcard-hint'));

    const english = { names: names(), hints: hints() };

    switchTo(fixture, 'fr');

    // Proper nouns, byte-identical across catalogs; only the one-line description moves (ADR-0077).
    expect(names()).toEqual(english.names);
    for (const [index, hint] of hints().entries()) expect(hint).not.toBe(english.hints[index]);
  });

  it('keeps the Hexly brand untranslated in both languages', () => {
    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;
    const eyebrow = () => (el.querySelector('.hero [appeyebrow]') as HTMLElement).textContent;
    const brand = () => (el.querySelector('.brand') as HTMLElement).textContent?.trim();

    expect(eyebrow()).toContain('Hexly');
    expect(brand()).toBe('Hexly');

    switchTo(fixture, 'fr');

    expect(eyebrow()).toContain('Hexly');
    expect(brand()).toBe('Hexly');
  });
});
