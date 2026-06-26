import {
  EnvironmentProviders,
  inject,
  Injectable,
  provideAppInitializer,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TranslocoService } from '@jsverse/transloco';
import { persistedPreference } from '../utils/persisted-preference';
import { LOCALES } from './transloco.config';
import { AppShellStore } from '../../shell/app-shell.store';

/** The languages Hexly ships (ADR-0014). English is the source and fallback. */
export type Locale = (typeof LOCALES)[number];

/**
 * Owns the active {@link Locale} for every actor — signed-in users and
 * anonymous public-link viewers alike — with no backend involvement (ADR-0014).
 * On first visit it follows the browser language (French when `navigator.language`
 * starts with `fr`, else English); thereafter a remembered choice wins. {@link set}
 * flips the active Transloco language so the UI updates live, and persists the
 * choice. It shares the detect/remember/apply mechanism with {@link ThemeService}
 * through {@link persistedPreference}.
 */
@Injectable({ providedIn: 'root' })
export class LocaleService {
  private readonly transloco = inject(TranslocoService);
  private readonly shell = inject(AppShellStore);

  private readonly pref = persistedPreference<Locale>({
    storageKey: 'hexly-locale',
    values: LOCALES,
    detect: () => {
      const browser =
        typeof navigator !== 'undefined' ? navigator.language : 'en';
      return browser?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
    },
    // Reflect the resolved locale onto Transloco so the first paint is correct.
    apply: (lang) => this.transloco.setActiveLang(lang),
  });

  /** The active locale, readable by the UI (e.g. to mark the switcher). */
  readonly lang = this.pref.value;

  /** Every locale Hexly ships, for a UI offering the choice (ADR-0014). */
  readonly locales = LOCALES;

  /**
   * Switch the UI language live and remember it for the next visit. A switch
   * re-renders every translated string at once and may need to pull an uncached
   * catalog, so it raises the shell's `full` curtain until the catalog is in —
   * the shell debounces it, so a cached (instant) switch shows nothing.
   */
  set(lang: Locale): void {
    this.pref.set(lang);
    const end = this.shell.beginLoading('full');
    firstValueFrom(this.transloco.load(lang)).finally(end);
  }

  /**
   * Load the active language's catalog before the app bootstraps. Wired through
   * `provideAppInitializer` (which blocks initial navigation until it resolves),
   * this guarantees the first *synchronous* translation — notably the route
   * title resolved by {@link TranslationTitleStrategy} — sees a populated
   * catalog instead of rendering the raw key (ADR-0014). A failed fetch must not
   * white-screen the app, so it degrades to Transloco's missing-key fallback.
   */
  async init(): Promise<void> {
    try {
      await firstValueFrom(this.transloco.load(this.lang()));
    } catch {
      /* a missing catalog degrades to the fallback rather than blocking boot */
    }
  }
}

/**
 * Load the active language's catalog before initial navigation (ADR-0014), so
 * the first synchronous translation — the route title resolved by
 * {@link TranslationTitleStrategy} — sees a populated catalog rather than the
 * raw key. Initial navigation blocks on this app initializer.
 */
export function provideLocale(): EnvironmentProviders {
  return provideAppInitializer(() => inject(LocaleService).init());
}
