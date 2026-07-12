import { EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';
import { InlineLoader, Translation } from '@jsverse/transloco';
import { LOCALES } from './transloco.config';

/**
 * One lib's catalogs, as Transloco consumes them (ADR-0049). The scope name is the prefix its keys
 * answer under — `{ toolPalette: … }` under scope `map` answers `map.toolPalette.…`. Transloco
 * camel-cases the scope to derive that prefix, so scope names stay single lowercase words.
 */
export interface TranslationScope {
  readonly scope: string;
  readonly loader: Record<(typeof LOCALES)[number], () => Promise<Translation | { default: Translation }>>;
}

/**
 * Scopes {@link LocaleService} loads with the active language, for copy that is read where no pipe
 * can trigger a load: imperatively (`TranslocoService.translate`), or carried as data — a route
 * title, a `TypeDefinition`'s label keys rendered by another lib (ADR-0049).
 */
export const EAGER_TRANSLATION_SCOPES = new InjectionToken<readonly TranslationScope[]>('EAGER_TRANSLATION_SCOPES');

/**
 * Register a lib's catalogs app-wide. A loaded scope is flattened into the active language, so its
 * keys resolve everywhere without a provider to inherit.
 *
 * It must NOT register `TRANSLOCO_SCOPE`: that token is how a pipe *triggers* a load, which an eager
 * scope does not need — and in a component's injector `translateSignal` reads it and prefixes the
 * key with it, so an app component asking for `entityTags.addPlaceholder` would resolve
 * `dnd.entityTags.addPlaceholder`. A scope whose readers all sit under one component is registered
 * the other way, with Transloco's `provideTranslocoScope` on that component (see `MapView`).
 */
export function provideEagerTranslations(...scopes: readonly TranslationScope[]): EnvironmentProviders {
  return makeEnvironmentProviders([
    scopes.map((scope) => ({ provide: EAGER_TRANSLATION_SCOPES, useValue: scope, multi: true })),
  ]);
}

/** Re-key a scope's loader by load path (`map/en`) rather than language, as `load()` expects. */
export function scopedInlineLoader({ scope, loader }: TranslationScope): InlineLoader {
  return Object.fromEntries(Object.entries(loader).map(([lang, load]) => [`${scope}/${lang}`, load]));
}
