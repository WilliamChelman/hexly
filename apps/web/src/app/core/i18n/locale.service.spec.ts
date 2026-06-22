import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { provideTranslocoTesting } from './transloco-testing';
import { LocaleService } from './locale.service';

describe('LocaleService', () => {
  let originalLanguage: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorage.clear();
    originalLanguage = Object.getOwnPropertyDescriptor(navigator, 'language');
  });

  afterEach(() => {
    localStorage.clear();
    if (originalLanguage) {
      Object.defineProperty(navigator, 'language', originalLanguage);
    }
  });

  function setBrowserLang(lang: string): void {
    Object.defineProperty(navigator, 'language', {
      configurable: true,
      get: () => lang,
    });
  }

  function build(): { locale: LocaleService; transloco: TranslocoService } {
    TestBed.configureTestingModule({ imports: [provideTranslocoTesting()] });
    return {
      locale: TestBed.inject(LocaleService),
      transloco: TestBed.inject(TranslocoService),
    };
  }

  it('defaults to French when the browser language starts with fr', () => {
    setBrowserLang('fr-FR');
    expect(build().locale.lang()).toBe('fr');
  });

  it('defaults to English for any other browser language', () => {
    setBrowserLang('en-GB');
    expect(build().locale.lang()).toBe('en');
  });

  it('prefers a previously stored choice over the browser language', () => {
    setBrowserLang('fr-FR');
    localStorage.setItem('hexly-locale', 'en');
    expect(build().locale.lang()).toBe('en');
  });

  it('applies the chosen language to Transloco on bootstrap', () => {
    setBrowserLang('fr-FR');
    expect(build().transloco.getActiveLang()).toBe('fr');
  });

  it('switches the language live and remembers the choice', () => {
    setBrowserLang('en-US');
    const { locale, transloco } = build();

    locale.set('fr');

    expect(locale.lang()).toBe('fr');
    // Live: the active Transloco language flips without a reload.
    expect(transloco.getActiveLang()).toBe('fr');
    // Remembered: persisted so the next visit reads it back.
    expect(localStorage.getItem('hexly-locale')).toBe('fr');
  });
});
