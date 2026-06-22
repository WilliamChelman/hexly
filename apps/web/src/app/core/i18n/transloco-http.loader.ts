import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Translation, TranslocoLoader } from '@jsverse/transloco';

/**
 * Fetches a language catalog from the web app's public assets (ADR-0014). The
 * URL is intentionally slash-less (`assets/…`, not `/assets/…`) so the
 * {@link apiPrefixInterceptor} leaves it alone — catalogs are static SPA assets
 * served off the document base (`<base href="/">`), not backend routes under
 * `/api`.
 */
@Injectable({ providedIn: 'root' })
export class TranslocoHttpLoader implements TranslocoLoader {
  private readonly http = inject(HttpClient);

  getTranslation(lang: string) {
    return this.http.get<Translation>(`assets/i18n/${lang}.json`);
  }
}
