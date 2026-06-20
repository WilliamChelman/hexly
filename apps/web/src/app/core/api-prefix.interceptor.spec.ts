import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { apiPrefixInterceptor } from './api-prefix.interceptor';

describe('apiPrefixInterceptor', () => {
  let http: HttpClient;
  let mock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiPrefixInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    mock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => mock.verify());

  it('prefixes a root-relative API request with /api', () => {
    http.get('/maps').subscribe();
    mock.expectOne('/api/maps');
  });

  it('does not double-prefix a request already under /api', () => {
    http.get('/api/health').subscribe();
    mock.expectOne('/api/health');
  });

  it('leaves an absolute URL untouched', () => {
    http.get('https://example.test/thing').subscribe();
    mock.expectOne('https://example.test/thing');
  });
});
