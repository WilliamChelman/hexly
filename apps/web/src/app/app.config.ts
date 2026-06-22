import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, TitleStrategy } from '@angular/router';
import { provideTransloco } from '@jsverse/transloco';
import { appRoutes } from './app.routes';
import { apiPrefixInterceptor } from './core/api-prefix.interceptor';
import { withCredentialsInterceptor } from './core/with-credentials.interceptor';
import { translocoAppConfig } from './core/i18n/transloco.config';
import { TranslocoHttpLoader } from './core/i18n/transloco-http.loader';
import { TranslationTitleStrategy } from './core/i18n/title-strategy';
import { LocaleService } from './core/i18n/locale.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes),
    provideHttpClient(
      withInterceptors([apiPrefixInterceptor, withCredentialsInterceptor]),
    ),
    // Runtime i18n (ADR-0014): one bundle ships every language; LocaleService
    // picks the active one on boot and the switcher flips it live.
    provideTransloco({
      config: translocoAppConfig,
      loader: TranslocoHttpLoader,
    }),
    // Load the active language's catalog before initial navigation, so the
    // first synchronous translation (the route title resolved by
    // TranslationTitleStrategy) sees a populated catalog rather than the raw
    // key (ADR-0014). Initial navigation blocks on this app initializer.
    provideAppInitializer(() => inject(LocaleService).init()),
    // Route titles are translation keys (ADR-0014), resolved live by language.
    { provide: TitleStrategy, useClass: TranslationTitleStrategy },
  ],
};
