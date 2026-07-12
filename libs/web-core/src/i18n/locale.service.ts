import { EnvironmentProviders, inject, Injectable, provideAppInitializer } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TranslocoService } from '@jsverse/transloco';
import { FORMAT_LOCALE_TAGS } from '@hexly/domain';
import { AuthScopedStorage } from '../services/auth-scoped-storage';
import { LOCALES } from './transloco.config';
import { EAGER_TRANSLATION_SCOPES, scopedInlineLoader } from './translation-scope';
import { AppShellStore } from '../services/app-shell.store';

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

  /** The libs whose catalogs load with the language rather than on first render (ADR-0049). */
  private readonly eagerScopes = inject(EAGER_TRANSLATION_SCOPES, { optional: true }) ?? [];

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
      return date.toLocaleDateString(this.formatLocale() || this.transloco.activeLang());
    } catch {
      return date.toLocaleDateString();
    }
  }

  /**
   * Switch the UI language live and remember it. Raises the `full` curtain while loading an uncached
   * catalog; the shell debounces it, so a cached switch shows nothing.
   *
   * The language is re-announced once the catalogs have landed, and that second announcement is what
   * makes an **eager scope** survive a switch. A Transloco pipe carrying no scope of its own — every
   * pipe outside the one component that provides one — re-resolves the moment the *root* catalog
   * lands, and nothing re-emits for a scope that lands after it: the eager copy would sit there
   * rendering raw keys, which is precisely the copy no pipe of its own lib is mounted to reload
   * (ADR-0049). `langChanges$` is deliberately not deduplicated, so re-setting the same language
   * re-emits and every pipe resolves against the catalogs now in hand.
   */
  set(lang: Locale): void {
    this.pref.set(lang);
    const end = this.shell.beginLoading('full');
    this.loadCatalogs(lang).finally(() => {
      this.transloco.setActiveLang(lang);
      end();
    });
  }

  /**
   * The app's root catalog plus every eager scope, in the given language (ADR-0049). A lazily-
   * provided scope reloads itself — its pipes re-resolve on the language change — but an eager one
   * has no such trigger, so the switch loads it here.
   */
  private loadCatalogs(lang: Locale): Promise<unknown> {
    return Promise.all([
      firstValueFrom(this.transloco.load(lang)),
      ...this.eagerScopes.map((scope) =>
        firstValueFrom(this.transloco.load(`${scope.scope}/${lang}`, { inlineLoader: scopedInlineLoader(scope) })),
      ),
    ]);
  }

  /**
   * Load the active language's catalogs before the app bootstraps. Wired through
   * `provideAppInitializer` (which blocks initial navigation until it resolves),
   * this guarantees the first *synchronous* translation — notably the route
   * title resolved by {@link TranslationTitleStrategy} — sees a populated
   * catalog instead of rendering the raw key (ADR-0014). A failed fetch must not
   * white-screen the app, so it degrades to Transloco's missing-key fallback.
   */
  async init(): Promise<void> {
    try {
      await this.loadCatalogs(this.lang());
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
