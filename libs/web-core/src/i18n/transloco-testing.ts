import { ModuleWithProviders } from '@angular/core';
import { Translation, TranslocoTestingModule } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { translocoAppConfig } from './transloco.config';

/**
 * Catalogs keyed the way Transloco caches them: a bare language (`en`) for the app's root catalog,
 * `scope/lang` (`map/en`) for a lib's scoped one (ADR-0049).
 */
export type TestCatalogs = Record<string, Translation>;

/**
 * Loads real catalogs into a TestBed (ADR-0014).
 *
 * Pass every project whose copy the spec renders: its own, plus any lib whose components it mounts.
 * Later sets win on collision, so a spec can override one catalog to exercise a fallback.
 */
export function provideTranslocoTesting(
  ...catalogs: readonly TestCatalogs[]
): ModuleWithProviders<TranslocoTestingModule> {
  const mod = TranslocoTestingModule.forRoot({
    langs: Object.assign({}, ...catalogs) as Record<string, Translation>,
    // The very config the running app uses (ADR-0014), so specs exercise the
    // real fallback / live-switch behaviour rather than a test-only imitation.
    translocoConfig: translocoAppConfig,
    // Preloads every key of `langs` — scoped load paths included — so a scoped key resolves in a
    // spec without a pipe having to trigger its load first.
    preloadLangs: true,
  });
  // Mirror the app's ICU transpiler so plural keys resolve in specs too (ADR-0014).
  return {
    ...mod,
    providers: [...(mod.providers ?? []), provideTranslocoMessageformat()],
  };
}
