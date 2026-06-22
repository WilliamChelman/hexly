import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { apiPrefixInterceptor } from '../api-prefix.interceptor';
import { TranslocoHttpLoader } from './transloco-http.loader';

describe('TranslocoHttpLoader', () => {
  let http: HttpTestingController;
  let loader: TranslocoHttpLoader;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        // The real API-prefix interceptor is in play: the loader must not be
        // rewritten under /api, since the catalogs are static SPA assets.
        provideHttpClient(withInterceptors([apiPrefixInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    loader = TestBed.inject(TranslocoHttpLoader);
  });

  afterEach(() => http.verify());

  it('loads a language catalog from public assets, off the /api prefix', () => {
    const catalog = { auth: { heading: 'Sign in' } };
    let result: unknown;
    loader.getTranslation('en').subscribe((t) => (result = t));

    const req = http.expectOne('assets/i18n/en.json');
    expect(req.request.url).not.toContain('/api');
    req.flush(catalog);

    expect(result).toEqual(catalog);
  });
});
