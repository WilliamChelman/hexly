import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, TitleStrategy } from '@angular/router';
import { provideTransloco } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { appRoutes } from './app.routes';
import { withCredentialsInterceptor } from './core/interceptors/with-credentials.interceptor';
import { translocoAppConfig } from './core/i18n/transloco.config';
import { TranslocoHttpLoader } from './core/i18n/transloco-http.loader';
import { TranslationTitleStrategy } from './core/i18n/title-strategy';
import { provideLocale } from './core/i18n/locale.service';
import { provideTheme } from './core/services/theme.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes),
    provideHttpClient(
      withInterceptors([withCredentialsInterceptor]),
    ),
    // Runtime i18n (ADR-0014): one bundle ships every language; LocaleService
    // picks the active one on boot and the switcher flips it live.
    provideTransloco({
      config: translocoAppConfig,
      loader: TranslocoHttpLoader,
    }),
    // ICU MessageFormat transpiler: count-aware plural keys (e.g. the hex count)
    // resolve per the active locale's plural rules. It delegates {{…}} to the
    // default transpiler, so existing double-brace interpolation is unaffected.
    provideTranslocoMessageformat(),
    // Apply the persisted/OS theme and load the active language's catalog
    // during bootstrap, before the first paint and initial navigation.
    provideTheme(),
    provideLocale(),
    // Route titles are translation keys (ADR-0014), resolved live by language.
    { provide: TitleStrategy, useClass: TranslationTitleStrategy },
  ],
};
