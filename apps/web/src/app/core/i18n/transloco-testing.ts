import { ModuleWithProviders } from '@angular/core';
import {
  Translation,
  TranslocoTestingModule,
  TranslocoTestingOptions,
} from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import en from '../../../../public/assets/i18n/en.json';
import fr from '../../../../public/assets/i18n/fr.json';
import { translocoAppConfig } from './transloco.config';

/**
 * Loads the real {@link en.json}/{@link fr.json} catalogs into a TestBed so
 * specs assert against the same English copy users see (ADR-0014). Existing
 * `textContent.toContain('Sign in')`-style assertions keep passing unchanged
 * and double as proof that the keys they exercise actually resolve.
 *
 * English is the default and the fallback, so a French gap renders the English
 * value rather than a raw key. Pass `langs` to override the catalogs — e.g. a
 * French tree with a key removed, to prove that fallback.
 */
export function provideTranslocoTesting(
  langs: TranslocoTestingOptions['langs'] = { en, fr } as Record<
    string,
    Translation
  >,
): ModuleWithProviders<TranslocoTestingModule> {
  const mod = TranslocoTestingModule.forRoot({
    langs,
    // The very config the running app uses (ADR-0014), so specs exercise the
    // real fallback / live-switch behaviour rather than a test-only imitation.
    translocoConfig: translocoAppConfig,
    preloadLangs: true,
  });
  // Mirror the app's ICU transpiler so plural keys resolve in specs too (ADR-0014).
  return {
    ...mod,
    providers: [...(mod.providers ?? []), provideTranslocoMessageformat()],
  };
}
