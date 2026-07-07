import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTransloco, TranslocoService } from '@jsverse/transloco';
import { provideTranslocoTesting } from './transloco-testing';
import { TranslocoHttpLoader } from './transloco-http.loader';
import { translocoAppConfig } from './transloco.config';
import { LocaleService } from './locale.service';

describe('LocaleService', () => {
  let originalLanguage: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorage.clear();
    originalLanguage = Object.getOwnPropertyDescriptor(navigator, 'language');
  });

  afterEach(() => {
    localStorage.clear();
    // `navigator.language` is a prototype accessor, so there's no *own*
    // descriptor to capture — `setBrowserLang` shadows it with an own property.
    // Delete that shadow (or restore a captured own descriptor) so the leak
    // never crosses into another spec file sharing this jsdom environment.
    if (originalLanguage) {
      Object.defineProperty(navigator, 'language', originalLanguage);
    } else {
      delete (navigator as unknown as { language?: unknown }).language;
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
    localStorage.setItem('hexly-u:hexly-locale', 'en');
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
    expect(localStorage.getItem('hexly-u:hexly-locale')).toBe('fr');
  });

  describe('Format Locale (ADR-0038)', () => {
    // 3 February 2026 — a day/month pair that disambiguates US from EU order.
    const ts = Date.UTC(2026, 1, 3, 12);

    it('follows the UI Locale when no Format Locale is chosen', () => {
      setBrowserLang('fr-FR');
      const { locale } = build();
      expect(locale.formatLocale()).toBe('');
      expect(locale.formatDate(ts)).toBe(new Date(ts).toLocaleDateString('fr'));
    });

    it('formats with the chosen Format Locale without touching the language', () => {
      setBrowserLang('en-US');
      const { locale, transloco } = build();

      locale.setFormatLocale('en-GB');

      expect(locale.formatDate(ts)).toBe(
        new Date(ts).toLocaleDateString('en-GB'),
      );
      // The UI language is a separate axis: still English.
      expect(locale.lang()).toBe('en');
      expect(transloco.getActiveLang()).toBe('en');
    });

    it('remembers the Format Locale choice', () => {
      setBrowserLang('en-US');
      build().locale.setFormatLocale('de-DE');
      expect(localStorage.getItem('hexly-u:hexly-format-locale')).toBe('de-DE');
    });

    it('ignores a stored value outside the curated list', () => {
      setBrowserLang('en-US');
      localStorage.setItem('hexly-u:hexly-format-locale', 'not-a-tag');
      const { locale } = build();
      expect(locale.formatLocale()).toBe('');
      expect(locale.formatDate(ts)).toBe(new Date(ts).toLocaleDateString('en'));
    });
  });

  /**
   * The real app has no preload (only the test harness does), so the first
   * synchronous translate would render a raw key before the catalog arrived.
   * `init()` is wired to `provideAppInitializer` to close that race; this drives
   * the genuine HTTP loader — deliberately NOT the preloading harness — so the
   * gap can't regress behind a preloaded TestBed.
   */
  describe('init (real HTTP loader, no preload)', () => {
    it('loads the active catalog so a later synchronous translate resolves', async () => {
      localStorage.setItem('hexly-u:hexly-locale', 'fr');
      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideTransloco({
            config: translocoAppConfig,
            loader: TranslocoHttpLoader,
          }),
        ],
      });
      const locale = TestBed.inject(LocaleService);
      const transloco = TestBed.inject(TranslocoService);
      const http = TestBed.inject(HttpTestingController);

      // Nothing is loaded yet: a bare translate (as the title strategy does)
      // would return the raw key.
      expect(transloco.translate('auth.signIn')).toBe('auth.signIn');

      // Loading French also pulls the English fallback (forkJoin), so both
      // catalogs are requested; flush both to let init() resolve.
      const ready = locale.init();
      http
        .expectOne('assets/i18n/fr.json')
        .flush({ auth: { signIn: 'Se connecter' } });
      http
        .expectOne('assets/i18n/en.json')
        .flush({ auth: { signIn: 'Sign in' } });
      await ready;

      expect(transloco.translate('auth.signIn')).toBe('Se connecter');
      http.verify();
    });
  });
});
