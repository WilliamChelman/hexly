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
  CORE_TRANSLATIONS,
} from '@hexly/web-core';
// The `/i18n` entry points carry the scope declaration and nothing else: importing a lib's
// translations through its main barrel drags that lib's code into the initial bundle (content-editor
// would pull Tiptap out of the lazy entity chunk).
import { WEB_UI_TRANSLATIONS } from '@hexly/web-ui/i18n';
import { WEB_ENTITY_TRANSLATIONS } from '@hexly/web-entity/i18n';
import { CONTENT_EDITOR_TRANSLATIONS } from '@hexly/content-editor/i18n';
import { providePluginDnd } from '@hexly/plugin-dnd/web';
import { provideBuiltInCommands } from './shell/command-palette/command-palette';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes),
    provideHttpClient(withInterceptors([withCredentialsInterceptor])),
    // Runtime i18n (ADR-0014): one bundle ships every language; LocaleService
    // picks the active one on boot and the switcher flips it live. The loader
    // fetches the app's own catalog — the copy of its pages and shell (ADR-0049).
    provideTransloco({
      config: translocoAppConfig,
      loader: TranslocoHttpLoader,
    }),
    // Each lib declares its catalog as a scope; these load with the language at
    // bootstrap because their keys are read where no pipe of the declaring lib
    // can trigger a load — from services, and from a type's label keys (ADR-0049).
    // `map` is absent by design: the Hex Map plugin provides it on MapView, so it is fetched
    // only when a hex map is on screen.
    provideEagerTranslations(
      CORE_TRANSLATIONS,
      WEB_UI_TRANSLATIONS,
      WEB_ENTITY_TRANSLATIONS,
      CONTENT_EDITOR_TRANSLATIONS,
    ),
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
    // Which plugins this build bundles, web side (ADR-0048, #192) — the twin of the
    // API's own list. "Bundled" means compiled-in (the ADR rules out runtime
    // third-party plugins), so a plugin joins by shipping a lib and being named here.
    // Each provider carries that plugin's types, views, and copy.
    providePluginDnd(),
  ],
};
