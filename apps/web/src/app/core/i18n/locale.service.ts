import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TranslocoService } from '@jsverse/transloco';
import { persistedPreference } from '../persisted-preference';
import { LOCALES } from './transloco.config';

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

  /** Switch the UI language live and remember it for the next visit. */
  set(lang: Locale): void {
    this.pref.set(lang);
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
