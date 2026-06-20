import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthStore } from './auth.store';

describe('AuthStore', () => {
  let store: AuthStore;
  let http: HttpTestingController;

  const ada = { id: 'u1', email: 'ada@hexly.test', displayName: 'Ada' };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(AuthStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('records the current user after a successful login', () => {
    store.login('ada@hexly.test', 'correct horse').subscribe();

    const req = http.expectOne('/auth/login');
    expect(req.request.body).toEqual({
      email: 'ada@hexly.test',
      password: 'correct horse',
    });
    req.flush(ada);

    expect(store.currentUser()).toEqual(ada);
    expect(store.isAuthenticated()).toBe(true);
  });

  it('clears the current user on logout', () => {
    store.login('ada@hexly.test', 'correct horse').subscribe();
    http.expectOne('/auth/login').flush(ada);

    store.logout().subscribe();
    http.expectOne('/auth/logout').flush(null);

    expect(store.currentUser()).toBeNull();
    expect(store.isAuthenticated()).toBe(false);
  });

  it('resolves to unauthenticated when /auth/me rejects', () => {
    let resolved: unknown = 'unset';
    store.refresh().subscribe((u) => (resolved = u));

    http
      .expectOne('/auth/me')
      .flush(null, { status: 401, statusText: 'Unauthorized' });

    expect(resolved).toBeNull();
    expect(store.currentUser()).toBeNull();
  });
});
