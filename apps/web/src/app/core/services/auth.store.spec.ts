import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthClient } from './auth.client';

describe('AuthClient', () => {
  let client: AuthClient;
  let http: HttpTestingController;

  const ada = { id: 'u1', email: 'ada@hexly.test', displayName: 'Ada' };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    client = TestBed.inject(AuthClient);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('records the current user after a successful login', () => {
    client.login('ada@hexly.test', 'correct horse').subscribe();

    const req = http.expectOne('/api/auth/login');
    expect(req.request.body).toEqual({
      email: 'ada@hexly.test',
      password: 'correct horse',
    });
    req.flush(ada);

    expect(client.currentUser()).toEqual(ada);
    expect(client.isAuthenticated()).toBe(true);
  });

  it('clears the current user on logout', () => {
    client.login('ada@hexly.test', 'correct horse').subscribe();
    http.expectOne('/api/auth/login').flush(ada);

    client.logout().subscribe();
    http.expectOne('/api/auth/logout').flush(null);

    expect(client.currentUser()).toBeNull();
    expect(client.isAuthenticated()).toBe(false);
  });

  it('clears the current user even when logout fails', () => {
    client.login('ada@hexly.test', 'correct horse').subscribe();
    http.expectOne('/api/auth/login').flush(ada);

    let completed = false;
    client.logout().subscribe({
      error: () => undefined,
      complete: () => (completed = true),
    });
    http
      .expectOne('/api/auth/logout')
      .flush(null, { status: 500, statusText: 'Server Error' });

    // Local session is cleared regardless, so the UI is never stuck signed in...
    expect(client.currentUser()).toBeNull();
    expect(client.isAuthenticated()).toBe(false);
    // ...and the stream still completes so the caller can navigate away.
    expect(completed).toBe(true);
  });

  it('resolves to unauthenticated when /auth/me returns 401', () => {
    let resolved: unknown = 'unset';
    client.refresh().subscribe((u) => (resolved = u));

    http
      .expectOne('/api/auth/me')
      .flush(null, { status: 401, statusText: 'Unauthorized' });

    expect(resolved).toBeNull();
    expect(client.currentUser()).toBeNull();
  });

  it('does NOT wipe the current user on a transient /auth/me failure', () => {
    // A known-authenticated user...
    client.login('ada@hexly.test', 'correct horse').subscribe();
    http.expectOne('/api/auth/login').flush(ada);

    let errored = false;
    client.refresh().subscribe({
      next: () => undefined,
      error: () => (errored = true),
    });
    http
      .expectOne('/api/auth/me')
      .flush(null, { status: 500, statusText: 'Server Error' });

    // A 5xx is transient, not a logout: rethrow and keep the mirror intact.
    expect(errored).toBe(true);
    expect(client.currentUser()).toEqual(ada);
    expect(client.isAuthenticated()).toBe(true);
  });
});
