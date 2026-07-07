import { TranslocoConfig } from '@jsverse/transloco';

/** The languages Hexly ships (ADR-0014); English is the source and fallback. */
export const LOCALES = ['en', 'fr'] as const;

/**
 * The single Transloco configuration shared by the running app and the test
 * harness, so the two can never drift on the behaviours that matter — English
 * as the fallback, the missing-key → fallback-value rule, and re-rendering on a
 * live language switch (ADR-0014). The active language is chosen at runtime by
 * {@link LocaleService}; `defaultLang` is only the pre-detection seed.
 */
export const translocoAppConfig: Partial<TranslocoConfig> = {
  availableLangs: [...LOCALES],
  defaultLang: 'en',
  fallbackLang: 'en',
  // Re-render templates when the language flips: a switch updates the UI live,
  // with no reload. Transloco leaves this off by default.
  reRenderOnLangChange: true,
  // A missing French key renders the English value rather than a raw key,
  // while still logging the gap so it gets fixed.
  missingHandler: {
    useFallbackTranslation: true,
    logMissingKey: true,
    allowEmpty: false,
  },
};
