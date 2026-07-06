import {
  EnvironmentProviders,
  inject,
  Injectable,
  provideAppInitializer,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TranslocoService } from '@jsverse/transloco';
import { FORMAT_LOCALE_TAGS } from '@hexly/domain';
import { AuthScopedStorage } from '../services/auth-scoped-storage';
import { LOCALES } from './transloco.config';
import { AppShellStore } from '../../shell/app-shell.store';

/** The languages Hexly ships (ADR-0014). English is the source and fallback. */
export type Locale = (typeof LOCALES)[number];

/**
 * The Format Locale choices (ADR-0038): the curated BCP-47 tags (shared with the
 * server via {@link FORMAT_LOCALE_TAGS}, which validates the same set), plus a
 * leading `''` = "Same as language" (follow the UI Locale) that only the picker
 * knows — the server never stores it (it clears the field instead). Labels come
 * from `Intl.DisplayNames` and previews from `toLocaleDateString`. (`en-CA`
 * doubles as the ISO-style choice — its short date reads `2026-07-05`.)
 */
export const FORMAT_LOCALES = ['', ...FORMAT_LOCALE_TAGS] as const;

/** A curated Format Locale tag, or `''` for "Same as language". */
export type FormatLocale = (typeof FORMAT_LOCALES)[number];

/** The app-default Locale: follow the browser language (ADR-0014). */
export function detectLocale(): Locale {
  const browser = typeof navigator !== 'undefined' ? navigator.language : 'en';
  return browser?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

/**
 * Owns the active {@link Locale} for every actor — signed-in users and
 * anonymous public-link viewers alike — with no backend involvement (ADR-0014).
 * On first visit it follows the browser language (French when `navigator.language`
 * starts with `fr`, else English); thereafter a remembered choice wins. {@link set}
 * flips the active Transloco language so the UI updates live, and persists the
 * choice. It shares the detect/remember/apply mechanism with {@link ThemeService}
 * through {@link AuthScopedStorage#preference}.
 */
@Injectable({ providedIn: 'root' })
export class LocaleService {
  private readonly transloco = inject(TranslocoService);
  private readonly shell = inject(AppShellStore);

  private readonly pref = inject(AuthScopedStorage).preference<Locale>({
    storageKey: 'hexly-locale',
    values: LOCALES,
    detect: detectLocale,
    // Reflect the resolved locale onto Transloco so the first paint is correct.
    apply: (lang) => this.transloco.setActiveLang(lang),
  });

  private readonly formatPref = inject(AuthScopedStorage).preference<FormatLocale>({
    storageKey: 'hexly-format-locale',
    values: FORMAT_LOCALES,
    detect: () => '',
    apply: () => undefined,
  });

  readonly lang = this.pref.value;
  readonly locales = LOCALES;

  /** The chosen Format Locale, `''` meaning "Same as language" (ADR-0038). */
  readonly formatLocale = this.formatPref.value;
  readonly formatLocales = FORMAT_LOCALES;

  /** Choose how dates/numbers read, independent of the UI language (ADR-0038). */
  setFormatLocale(tag: FormatLocale): void {
    this.formatPref.set(tag);
  }

  /**
   * Format an epoch-millis timestamp as a short date under the Format Locale,
   * falling back to the active UI language (the live Transloco signal, so
   * "Same as language" tracks a switch), then to the runtime default if the
   * tag is somehow invalid — a bad locale must never take a render down
   * (ADR-0014).
   */
  formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    try {
      return date.toLocaleDateString(
        this.formatLocale() || this.transloco.activeLang(),
      );
    } catch {
      return date.toLocaleDateString();
    }
  }

  // Switch the UI language live and remember it. Raises `full` curtain while
  // loading an uncached catalog; shell debounces so cached switches show nothing.
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
