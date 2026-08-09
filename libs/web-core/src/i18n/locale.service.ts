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
 * The Format Locale choices (ADR-0038): the curated BCP-47 tags of
 * {@link FORMAT_LOCALE_TAGS}, plus a leading `''` = "Same as language" that only the
 * picker knows — the server never stores it (it clears the field instead). `en-CA`
 * doubles as the ISO-style choice: its short date reads `2026-07-05`.
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
 * Owns the active {@link Locale} with no backend involvement (ADR-0014): the choice is a device fact,
 * resolved before and independently of any account. On first visit it follows the browser language;
 * thereafter a remembered choice wins.
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
   * Format an epoch-millis timestamp as a short date under the Format Locale, falling back
   * to the active UI language (the live Transloco signal, so "Same as language" tracks a
   * switch), then to the runtime default — an invalid tag must never take a render down.
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
   * The language is re-announced *after* the catalogs land: a pipe with no scope of its own
   * re-resolves the moment the root catalog lands and nothing re-emits for an eager scope landing
   * later, which would leave that copy rendering raw keys (ADR-0049). `langChanges$` is not
   * deduplicated, so re-setting the same language re-emits against the catalogs now in hand.
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
   * The app's root catalog plus every eager scope, in the given language. A lazily-provided scope
   * reloads itself on the language change; an eager one has no such trigger, so it loads here.
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
   * Load the active language's catalogs before the app bootstraps, so the first *synchronous*
   * translation — notably the route title resolved by {@link TranslationTitleStrategy} — sees a
   * populated catalog instead of the raw key. A failed fetch degrades to Transloco's missing-key
   * fallback rather than white-screening the app.
   */
  async init(): Promise<void> {
    try {
      await this.loadCatalogs(this.lang());
    } catch {
      /* a missing catalog degrades to the fallback rather than blocking boot */
    }
  }
}

/** Loads the active language's catalog via an app initializer: initial navigation blocks on it. */
export function provideLocale(): EnvironmentProviders {
  return provideAppInitializer(() => inject(LocaleService).init());
}
