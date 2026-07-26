import { EnvironmentProviders, inject, Injectable, provideAppInitializer, signal } from '@angular/core';

import { safeStorageGet, safeStorageSet } from '../utils/safe';

/** The day/night axis the interface is painted along — not a World Theme (ADR-0075). */
export type ColorScheme = 'solar' | 'astral';

const STORAGE_KEY = 'hexly-color-scheme';

/** The app-default ColorScheme: follow the OS preference. */
export function detectColorScheme(): ColorScheme {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'astral'
    : 'solar';
}

/**
 * Owns the active {@link ColorScheme}, reflected onto `<html data-color-scheme>` (the
 * selector every token declaration keys off). Persisted unscoped under
 * `hexly-color-scheme` — not auth-scoped, unlike LocaleService: the pre-paint bootstrap
 * in `index.html` reads this key and cannot know the user hash, so a scoped key would
 * never round-trip. For a signed-in user the ColorScheme also roams via the account bag
 * (ADR-0038). When neither the account nor local storage has a choice, we follow the OS
 * preference.
 */
@Injectable({ providedIn: 'root' })
export class ColorSchemeService {
  private read(): ColorScheme {
    const stored = safeStorageGet(STORAGE_KEY).unwrapOr(null); // private mode → null → OS preference
    if (stored === 'solar' || stored === 'astral') return stored;
    return detectColorScheme();
  }

  private readonly _colorScheme = signal<ColorScheme>(this.read());

  readonly colorScheme = this._colorScheme.asReadonly();

  constructor() {
    document.documentElement.dataset['colorScheme'] = this._colorScheme();
  }

  /** Swap between solar (day) and astral (night). */
  toggle(): void {
    this.set(this.colorScheme() === 'astral' ? 'solar' : 'astral');
  }

  set(colorScheme: ColorScheme): void {
    this._colorScheme.set(colorScheme);
    document.documentElement.dataset['colorScheme'] = colorScheme;
    safeStorageSet(STORAGE_KEY, colorScheme); // private mode: the choice just doesn't persist
  }
}

/**
 * Instantiate {@link ColorSchemeService} during bootstrap so its constructor reflects
 * the persisted/OS ColorScheme onto `<html data-color-scheme>` before the first paint.
 */
export function provideColorScheme(): EnvironmentProviders {
  return provideAppInitializer(() => void inject(ColorSchemeService));
}
