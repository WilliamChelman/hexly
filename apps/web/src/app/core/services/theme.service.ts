import {
  EnvironmentProviders,
  inject,
  Injectable,
  provideAppInitializer,
  signal,
} from '@angular/core';

/** The two themes of Hexly's "cartographer's table": day paper, night sky. */
export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'hexly-theme';

/**
 * Owns the active {@link Theme}, reflected onto `<html data-theme>` (the selector
 * every token override keys off). Theme is a per-device preference, so it is
 * persisted unscoped under `hexly-theme` — the same key the pre-paint bootstrap
 * in `index.html` reads, which has no auth context to scope by. When the user has
 * never chosen, we follow the OS preference.
 *
 * ponytail: deliberately not auth-scoped (unlike LocaleService). The pre-paint
 * script cannot know the user hash, so an auth-scoped key could never round-trip
 * and the saved theme reverted on every reload.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private read(): Theme {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'light' || stored === 'dark') return stored;
    } catch { /* private mode */ }
    return typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }

  private readonly _theme = signal<Theme>(this.read());

  /** The active theme, readable by the UI (e.g. to label the toggle). */
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
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch { /* private mode */ }
  }
}

/**
 * Instantiate {@link ThemeService} during bootstrap so its constructor reflects
 * the persisted/OS theme onto `<html data-theme>` before the first paint.
 */
export function provideTheme(): EnvironmentProviders {
  return provideAppInitializer(() => void inject(ThemeService));
}
