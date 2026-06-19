import { Injectable, signal } from '@angular/core';

/** The two themes of Hexly's "cartographer's table": day paper, night sky. */
export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'hexly-theme';

/**
 * Owns the active {@link Theme}. The choice is reflected onto
 * `<html data-theme>` (the selector every token override keys off) and
 * persisted, so it survives reloads and matches the pre-paint bootstrap in
 * `index.html`. When the user has never chosen, we follow the OS preference.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  /** The active theme, readable by the UI (e.g. to label the toggle). */
  readonly theme = signal<Theme>(this.initial());

  constructor() {
    this.apply(this.theme());
  }

  /** Swap between parchment (light) and astral (dark). */
  toggle(): void {
    this.set(this.theme() === 'dark' ? 'light' : 'dark');
  }

  set(theme: Theme): void {
    this.theme.set(theme);
    this.apply(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* storage may be unavailable (private mode); the in-memory value still holds */
    }
  }

  private apply(theme: Theme): void {
    document.documentElement.dataset['theme'] = theme;
  }

  private initial(): Theme {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'light' || stored === 'dark') return stored;
    } catch {
      /* fall through to OS preference */
    }
    const prefersDark =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
  }
}
