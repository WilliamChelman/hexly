import { EnvironmentProviders, inject, Injectable, provideAppInitializer, signal } from '@angular/core';

import { safeStorageGet, safeStorageSet } from '../utils/safe';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'hexly-theme';

/** The app-default Theme: follow the OS preference. */
export function detectTheme(): Theme {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

/**
 * Owns the active {@link Theme}, reflected onto `<html data-theme>` (the selector
 * every token override keys off). Persisted unscoped under `hexly-theme` — not
 * auth-scoped, unlike LocaleService: the pre-paint bootstrap in `index.html` reads
 * this key and cannot know the user hash, so a scoped key would never round-trip.
 * For a signed-in user the theme also roams via the account bag (ADR-0038). When
 * neither the account nor local storage has a choice, we follow the OS preference.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private read(): Theme {
    const stored = safeStorageGet(STORAGE_KEY).unwrapOr(null); // private mode → null → OS preference
    if (stored === 'light' || stored === 'dark') return stored;
    return detectTheme();
  }

  private readonly _theme = signal<Theme>(this.read());

  readonly theme = this._theme.asReadonly();

  constructor() {
    document.documentElement.dataset['theme'] = this._theme();
  }

  /** Swap between solar (light) and astral (dark). */
  toggle(): void {
    this.set(this.theme() === 'dark' ? 'light' : 'dark');
  }

  set(theme: Theme): void {
    this._theme.set(theme);
    document.documentElement.dataset['theme'] = theme;
    safeStorageSet(STORAGE_KEY, theme); // private mode: the choice just doesn't persist
  }
}

/**
 * Instantiate {@link ThemeService} during bootstrap so its constructor reflects
 * the persisted/OS theme onto `<html data-theme>` before the first paint.
 */
export function provideTheme(): EnvironmentProviders {
  return provideAppInitializer(() => void inject(ThemeService));
}
