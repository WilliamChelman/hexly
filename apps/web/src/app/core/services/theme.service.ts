import { Injectable } from '@angular/core';
import { persistedPreference } from '../utils/persisted-preference';

/** The two themes of Hexly's "cartographer's table": day paper, night sky. */
export type Theme = 'light' | 'dark';

/**
 * Owns the active {@link Theme}. The choice is reflected onto
 * `<html data-theme>` (the selector every token override keys off) and
 * persisted through the shared {@link persistedPreference} mechanism, so it
 * survives reloads and matches the pre-paint bootstrap in `index.html`. When the
 * user has never chosen, we follow the OS preference.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly pref = persistedPreference<Theme>({
    storageKey: 'hexly-theme',
    values: ['light', 'dark'],
    detect: () =>
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light',
    apply: (theme) => {
      document.documentElement.dataset['theme'] = theme;
    },
  });

  /** The active theme, readable by the UI (e.g. to label the toggle). */
  readonly theme = this.pref.value;

  /** Swap between solar (light) and astral (dark). */
  toggle(): void {
    this.set(this.theme() === 'dark' ? 'light' : 'dark');
  }

  set(theme: Theme): void {
    this.pref.set(theme);
  }
}
