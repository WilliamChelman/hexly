import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthUser, Preferences } from '@hexly/domain';
import { provideTranslocoTesting } from '../i18n/transloco-testing';
import { LocaleService } from '../i18n/locale.service';
import { detectTheme, ThemeService } from './theme.service';
import { AuthClient } from './auth.client';
import { MockAuthClient } from '../testing/auth-client.mock';
import { PreferencesSync } from './preferences-sync';

describe('PreferencesSync (ADR-0038)', () => {
  let auth: MockAuthClient;
  let http: HttpTestingController;
  let locale: LocaleService;
  let theme: ThemeService;
  let originalLanguage: PropertyDescriptor | undefined;

  const ada = (preferences: Preferences): AuthUser => ({
    id: 'u1',
    email: 'ada@hexly.test',
    displayName: 'Ada',
    preferences,
    roles: ['create-worlds'],
    isSuperadmin: false,
  });

  beforeEach(() => {
    localStorage.clear();
    originalLanguage = Object.getOwnPropertyDescriptor(navigator, 'language');
    Object.defineProperty(navigator, 'language', {
      configurable: true,
      get: () => 'en-US',
    });
    auth = new MockAuthClient();
    TestBed.configureTestingModule({
      imports: [provideTranslocoTesting()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthClient, useValue: auth },
      ],
    });
    TestBed.inject(PreferencesSync);
    locale = TestBed.inject(LocaleService);
    theme = TestBed.inject(ThemeService);
    http = TestBed.inject(HttpTestingController);
    TestBed.flushEffects();
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
    // `navigator.language` is a prototype accessor: there's no *own* descriptor
    // to capture, so delete the own property this spec shadowed it with (or
    // restore a captured own descriptor) to avoid leaking into other spec files.
    if (originalLanguage) {
      Object.defineProperty(navigator, 'language', originalLanguage);
    } else {
      delete (navigator as unknown as { language?: unknown }).language;
    }
  });

  it('adopts server Preferences when the session resolves — server wins over the local cache', () => {
    localStorage.setItem('hexly-u:hexly-locale', 'en');

    auth.setUser(ada({ locale: 'fr', theme: 'dark', formatLocale: 'en-GB' }));
    TestBed.flushEffects();

    expect(locale.lang()).toBe('fr');
    expect(locale.formatLocale()).toBe('en-GB');
    expect(theme.theme()).toBe('dark');
    // The boot cache is overwritten too, so the next reload paints right away.
    expect(localStorage.getItem('hexly-u:hexly-locale')).toBe('fr');
    // Hydration is a read, never an echo back to the server.
    http.expectNone('/api/auth/me/preferences');
  });

  it('resets to app defaults when the server bag is empty (migration reset, ADR-0038)', () => {
    // A localStorage-only choice diverging from the default…
    localStorage.setItem('hexly-u:hexly-locale', 'fr');

    // …reverts when the authoritative server bag holds no choice.
    auth.setUser(ada({}));
    TestBed.flushEffects();

    expect(locale.lang()).toBe('en');
    expect(locale.formatLocale()).toBe('');
    http.expectNone('/api/auth/me/preferences');
  });

  it('keeps a device-local theme when the account bag has no theme (ADR-0038)', () => {
    // Theme is persisted unscoped (read before login), so an absent server theme
    // must not reset a device-local choice to the OS default. Pick the opposite
    // of detection so a regression to detectTheme() would flip it.
    const local = detectTheme() === 'dark' ? 'light' : 'dark';
    theme.set(local);
    TestBed.flushEffects();

    auth.setUser(ada({}));
    TestBed.flushEffects();

    expect(theme.theme()).toBe(local);
    http.expectNone('/api/auth/me/preferences');
  });

  it('pushes a post-boot change to the server', () => {
    auth.setUser(ada({}));
    TestBed.flushEffects();

    locale.set('fr');
    TestBed.flushEffects();

    const req = http.expectOne('/api/auth/me/preferences');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ locale: 'fr' });
    req.flush({ locale: 'fr' });
  });

  it('clears the Format Locale with an explicit null ("Same as language")', () => {
    auth.setUser(ada({ formatLocale: 'en-GB' }));
    TestBed.flushEffects();

    locale.setFormatLocale('');
    TestBed.flushEffects();

    const req = http.expectOne('/api/auth/me/preferences');
    expect(req.request.body).toEqual({ formatLocale: null });
    req.flush({});
  });

  it('persists nothing while anonymous — public-link viewers stay local-only', () => {
    locale.set('fr');
    theme.set('dark');
    TestBed.flushEffects();

    http.expectNone('/api/auth/me/preferences');
    // The ADR-0014 behaviour is intact: the choice still lands locally.
    expect(locale.lang()).toBe('fr');
    expect(localStorage.getItem('hexly-u:hexly-locale')).toBe('fr');
  });
});
