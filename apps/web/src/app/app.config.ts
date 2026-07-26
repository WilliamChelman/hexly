import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, TitleStrategy } from '@angular/router';
import { provideTransloco } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { appRoutes } from './app.routes';
import {
  withCredentialsInterceptor,
  sessionRenewalInterceptor,
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
import { WEB_ENTITY_TRANSLATIONS, COLLAB_TRANSLATIONS } from '@hexly/web-entity/i18n';
import { ADMIN_TRANSLATIONS } from '@hexly/admin-web/i18n';
import { COMMAND_PALETTE_TRANSLATIONS } from '@hexly/command-palette-web/i18n';
import { DICE_TRANSLATIONS } from '@hexly/dice-web/i18n';
import { ENTITY_TYPES, ENTITY_VIEW_OUTLET } from '@hexly/web-entity';
import { EntityEmbedHostComponent } from './pages/entity/components/entity-embed-host.component';
import { provideEntityViewChoices } from './entity-types/entity-view-choices.provider';
import { provideDetailedEntityCreator } from './entity-types/detailed-entity-creator.provider';
import { providePluginContent } from '@hexly/plugin-content/web';
import { providePluginBoard } from '@hexly/plugin-board/web';
import { providePluginAsset } from '@hexly/plugin-asset/web';
import { providePluginDnd } from '@hexly/plugin-dnd/web';
import { providePluginDrawSteel } from '@hexly/plugin-draw-steel/web';
import { providePluginHexmap } from '@hexly/plugin-hexmap/web';
import { TypeRegistry } from './entity-types/type-registry';
import { provideBuiltInCommands } from './shell/built-in-commands';
import { provideDesktopMenuCommands } from './shell/desktop-menu-commands';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes),
    // Credentials first, so the retry the renewal issues inherits them (ADR-0004, ADR-0070).
    provideHttpClient(withInterceptors([withCredentialsInterceptor, sessionRenewalInterceptor])),
    // Fetch the client config (ADR-0052) before stabilisation, ahead of the plugin providers below, so
    // the enabled-Plugin set is settled before any registry reads it — and the ADR-0071 gates cannot
    // flicker on first render.
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
    // admin's scope is eager because its route `title` (`admin.tabTitle`) is resolved by the
    // TitleStrategy before the lazy Admin page can trigger the load (ADR-0049).
    provideEagerTranslations(
      CORE_TRANSLATIONS,
      WEB_ENTITY_TRANSLATIONS,
      COLLAB_TRANSLATIONS,
      ADMIN_TRANSLATIONS,
      // The palette's section labels and Command copy are read from Providers (services), where no
      // pipe of the palette lib is guaranteed to trigger the scope's load (ADR-0049).
      COMMAND_PALETTE_TRANSLATIONS,
      // The dice Provider reads its section/roll/hint copy imperatively too (ADR-0049).
      DICE_TRANSLATIONS,
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
    // The native menu's clicks arrive as invocations of those same Commands (ADR-0070); inert in a browser.
    provideDesktopMenuCommands(),
    // The read contract a lib injects to ask what Entity Types exist (ADR-0048).
    { provide: ENTITY_TYPES, useExisting: TypeRegistry },
    // The Entity View Outlet host a plugin transcludes another Entity through, and the resolver naming a
    // target's afforded Views — the seams the Board's Embed consumes without importing the app (ADR-0062, #270).
    { provide: ENTITY_VIEW_OUTLET, useValue: EntityEmbedHostComponent },
    provideEntityViewChoices(),
    // The create dialog behind Inline Creation's details row — the `@` picker asks for it through this
    // seam rather than importing the app (ADR-0073).
    provideDetailedEntityCreator(),
    // Which plugins this build bundles, web side (ADR-0048, ADR-0050) — the twin of the API's list
    // in `bundled-plugins.ts`. Bundled means compiled-in: a plugin joins by shipping a lib and being
    // named here. Each provider carries that plugin's types, views, structured data-types, and copy.
    providePluginContent(),
    providePluginHexmap(),
    providePluginBoard(),
    providePluginAsset(),
    providePluginDnd(),
    providePluginDrawSteel(),
  ],
};
