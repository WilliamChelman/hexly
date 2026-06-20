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

  it('clears the current user even when logout fails', () => {
    store.login('ada@hexly.test', 'correct horse').subscribe();
    http.expectOne('/auth/login').flush(ada);

    let completed = false;
    store.logout().subscribe({
      error: () => undefined,
      complete: () => (completed = true),
    });
    http
      .expectOne('/auth/logout')
      .flush(null, { status: 500, statusText: 'Server Error' });

    // Local session is cleared regardless, so the UI is never stuck signed in...
    expect(store.currentUser()).toBeNull();
    expect(store.isAuthenticated()).toBe(false);
    // ...and the stream still completes so the caller can navigate away.
    expect(completed).toBe(true);
  });

  it('resolves to unauthenticated when /auth/me returns 401', () => {
    let resolved: unknown = 'unset';
    store.refresh().subscribe((u) => (resolved = u));

    http
      .expectOne('/auth/me')
      .flush(null, { status: 401, statusText: 'Unauthorized' });

    expect(resolved).toBeNull();
    expect(store.currentUser()).toBeNull();
  });

  it('does NOT wipe the current user on a transient /auth/me failure', () => {
    // A known-authenticated user...
    store.login('ada@hexly.test', 'correct horse').subscribe();
    http.expectOne('/auth/login').flush(ada);

    let errored = false;
    store.refresh().subscribe({
      next: () => undefined,
      error: () => (errored = true),
    });
    http
      .expectOne('/auth/me')
      .flush(null, { status: 500, statusText: 'Server Error' });

    // A 5xx is transient, not a logout: rethrow and keep the mirror intact.
    expect(errored).toBe(true);
    expect(store.currentUser()).toEqual(ada);
    expect(store.isAuthenticated()).toBe(true);
  });
});
