import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, TitleStrategy } from '@angular/router';
import { provideTransloco } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { appRoutes } from './app.routes';
import {
  withCredentialsInterceptor,
  translocoAppConfig,
  TranslocoHttpLoader,
  TranslationTitleStrategy,
  provideEagerTranslations,
  provideLocale,
  provideTheme,
  providePreferencesSync,
  provideClientConfig,
  CORE_TRANSLATIONS,
} from '@hexly/web-core';
// The `/i18n` entry points carry the scope declaration and nothing else: importing a lib's
// translations through its main barrel drags that lib's code into the initial bundle (content-editor
// would pull Tiptap out of the lazy entity chunk).
import { WEB_UI_TRANSLATIONS } from '@hexly/web-ui/i18n';
import { WEB_ENTITY_TRANSLATIONS } from '@hexly/web-entity/i18n';
import { ENTITY_TYPES } from '@hexly/web-entity';
import { providePluginContent } from '@hexly/plugin-content/web';
import { providePluginDnd } from '@hexly/plugin-dnd/web';
import { providePluginHexmap } from '@hexly/plugin-hexmap/web';
import { TypeRegistry } from './entity-types/type-registry';
import { provideBuiltInCommands } from './shell/command-palette/command-palette.component';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes),
    provideHttpClient(withInterceptors([withCredentialsInterceptor])),
    // Fetch the client config (ADR-0052) before stabilisation, ahead of the plugin providers below, so
    // the enabled-Plugin set is settled before any registry reads it.
    provideClientConfig(),
    // Runtime i18n (ADR-0014): one bundle ships every language; LocaleService
    // picks the active one on boot and the switcher flips it live. The loader
    // fetches the app's own catalog — the copy of its pages and shell (ADR-0049).
    provideTransloco({
      config: translocoAppConfig,
      loader: TranslocoHttpLoader,
    }),
    // These scopes load at bootstrap because their keys are read where no pipe of the
    // declaring lib can trigger a load — from services, and from a type's label keys
    // (ADR-0049). A plugin's scope is not listed here: it rides on its `providePluginX()`
    // (the content plugin's `editor` scope arrives with `providePluginContent()`).
    provideEagerTranslations(CORE_TRANSLATIONS, WEB_UI_TRANSLATIONS, WEB_ENTITY_TRANSLATIONS),
    // ICU MessageFormat transpiler: count-aware plural keys (e.g. the hex count)
    // resolve per the active locale's plural rules. It delegates {{…}} to the
    // default transpiler, so existing double-brace interpolation is unaffected.
    provideTranslocoMessageformat(),
    // Apply the persisted/OS theme and load the active language's catalog
    // during bootstrap, before the first paint and initial navigation.
    provideTheme(),
    provideLocale(),
    // Roam Preferences with the account (ADR-0038): hydrate from /auth/me,
    // push signal changes back as PATCHes.
    providePreferencesSync(),
    // Route titles are translation keys (ADR-0014), resolved live by language.
    { provide: TitleStrategy, useClass: TranslationTitleStrategy },
    // The Command Palette's built-in Providers (ADR-0032), registered for the
    // app's lifetime by the palette when it mounts.
    provideBuiltInCommands(),
    // The read contract a lib injects to ask what Entity Types exist (ADR-0048).
    { provide: ENTITY_TYPES, useExisting: TypeRegistry },
    // Which plugins this build bundles, web side (ADR-0048, ADR-0050) — the twin of the API's list
    // in `bundled-plugins.ts`. Bundled means compiled-in: a plugin joins by shipping a lib and being
    // named here. Each provider carries that plugin's types, views, structured data-types, and copy.
    providePluginContent(),
    providePluginHexmap(),
    providePluginDnd(),
  ],
};
