import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { provideTranslocoTesting } from '../core/i18n/transloco-testing';
import { Styleguide } from './styleguide';

describe('Styleguide', () => {
  function render() {
    TestBed.configureTestingModule({
      imports: [Styleguide, provideTranslocoTesting()],
      providers: [provideRouter([])],
    });
    const fixture = TestBed.createComponent(Styleguide);
    fixture.detectChanges();
    return fixture;
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
    expect(guide.textContent).toContain('Retour à la carte');
    expect(guide.textContent).not.toContain('Back to map');

    const hero = el.querySelector('.hero') as HTMLElement;
    expect(hero.textContent).toContain('table du cartographe');
    expect(hero.textContent).not.toContain('cartographer’s table');
  });

  it('renders swatch display names from keys, localized to the active language', () => {
    const fixture = render();
    const swatches = () =>
      Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('.swatches'),
      )
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
    const lede = () =>
      (fixture.nativeElement as HTMLElement).querySelector(
        '.hero-lede',
      ) as HTMLElement;

    // The emphasis/code markup survives the move into a single key.
    expect(lede().querySelector('strong')).not.toBeNull();
    expect(lede().querySelector('code')?.textContent).toBe('apps/web');
    expect(lede().textContent).toContain('Parchment');

    switchTo(fixture, 'fr');

    expect(lede().querySelector('strong')?.textContent).toBe('Parchemin');
    expect(lede().textContent).not.toContain('Parchment');
  });

  it('keeps the Hexly brand untranslated in both languages', () => {
    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;
    const eyebrow = () =>
      (el.querySelector('.hero [appeyebrow]') as HTMLElement).textContent;
    const brand = () =>
      (el.querySelector('.brand') as HTMLElement).textContent?.trim();

    expect(eyebrow()).toContain('Hexly');
    expect(brand()).toBe('Hexly');

    switchTo(fixture, 'fr');

    expect(eyebrow()).toContain('Hexly');
    expect(brand()).toBe('Hexly');
  });
});
