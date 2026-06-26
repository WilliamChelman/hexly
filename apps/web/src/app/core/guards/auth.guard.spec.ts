import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  convertToParamMap,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { firstValueFrom, isObservable, Observable } from 'rxjs';
import { authGuard, loginGuard } from './auth.guard';
import { AuthClient } from '../services/auth.client';

describe('authGuard', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /** Invoke the functional guard the way the router would. */
  function run(url = '/atlas/42') {
    return TestBed.runInInjectionContext(() =>
      authGuard(
        {} as ActivatedRouteSnapshot,
        { url } as RouterStateSnapshot,
      ),
    );
  }

  function settle(result: unknown): Promise<boolean | UrlTree> {
    return isObservable(result)
      ? firstValueFrom(result as Observable<boolean | UrlTree>)
      : Promise.resolve(result as boolean | UrlTree);
  }

  it('redirects to /login preserving the intended destination when there is no session', async () => {
    const result = run('/atlas/42');
    // firstValueFrom subscribes synchronously, issuing the /auth/me request.
    const settled = settle(result);

    http
      .expectOne('/api/auth/me')
      .flush(null, { status: 401, statusText: 'Unauthorized' });

    const value = await settled;
    expect(value).toBeInstanceOf(UrlTree);
    expect((value as UrlTree).toString()).toBe(
      '/login?returnUrl=%2Fatlas%2F42',
    );
  });

  it('re-validates against the server and allows activation when the session holds', async () => {
    const store = TestBed.inject(AuthClient);
    const ada = { id: 'u1', email: 'ada@hexly.test', displayName: 'Ada' };
    store.login('ada@hexly.test', 'pw').subscribe();
    http.expectOne('/api/auth/login').flush(ada);

    // Even when already authenticated the guard re-checks /auth/me so a
    // server-side revocation is noticed on in-app navigation.
    const result = run();
    const settled = settle(result);

    http.expectOne('/api/auth/me').flush(ada);

    expect(await settled).toBe(true);
  });

  it('redirects an authenticated user whose session was revoked server-side', async () => {
    const store = TestBed.inject(AuthClient);
    store.login('ada@hexly.test', 'pw').subscribe();
    http.expectOne('/api/auth/login').flush({
      id: 'u1',
      email: 'ada@hexly.test',
      displayName: 'Ada',
    });

    const result = run('/atlas/42');
    const settled = settle(result);

    http
      .expectOne('/api/auth/me')
      .flush(null, { status: 401, statusText: 'Unauthorized' });

    const value = await settled;
    expect(value).toBeInstanceOf(UrlTree);
    expect((value as UrlTree).toString()).toBe(
      '/login?returnUrl=%2Fatlas%2F42',
    );
  });

  it('lets a known-authenticated user through on a transient /auth/me failure', async () => {
    const store = TestBed.inject(AuthClient);
    store.login('ada@hexly.test', 'pw').subscribe();
    http.expectOne('/api/auth/login').flush({
      id: 'u1',
      email: 'ada@hexly.test',
      displayName: 'Ada',
    });

    const result = run();
    const settled = settle(result);

    // A 5xx is transient; don't boot an authenticated user to /login.
    http
      .expectOne('/api/auth/me')
      .flush(null, { status: 500, statusText: 'Server Error' });

    expect(await settled).toBe(true);
  });
});

describe('loginGuard', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /** Invoke the functional guard with the given returnUrl query param. */
  function run(returnUrl?: string) {
    const route = {
      queryParamMap: convertToParamMap(returnUrl ? { returnUrl } : {}),
    } as unknown as ActivatedRouteSnapshot;
    return TestBed.runInInjectionContext(() =>
      loginGuard(route, {} as RouterStateSnapshot),
    );
  }

  function settle(result: unknown): Promise<boolean | UrlTree> {
    return isObservable(result)
      ? firstValueFrom(result as Observable<boolean | UrlTree>)
      : Promise.resolve(result as boolean | UrlTree);
  }

  it('lets an unauthenticated user reach /login', async () => {
    const settled = settle(run());

    http
      .expectOne('/api/auth/me')
      .flush(null, { status: 401, statusText: 'Unauthorized' });

    expect(await settled).toBe(true);
  });

  it('bounces an already-authenticated user to the editor', async () => {
    const ada = { id: 'u1', email: 'ada@hexly.test', displayName: 'Ada' };
    const settled = settle(run());

    http.expectOne('/api/auth/me').flush(ada);

    const value = await settled;
    expect(value).toBeInstanceOf(UrlTree);
    expect((value as UrlTree).toString()).toBe('/');
  });

  it('bounces an already-authenticated user to returnUrl when present', async () => {
    const ada = { id: 'u1', email: 'ada@hexly.test', displayName: 'Ada' };
    const settled = settle(run('/atlas/42'));

    http.expectOne('/api/auth/me').flush(ada);

    const value = await settled;
    expect(value).toBeInstanceOf(UrlTree);
    expect((value as UrlTree).toString()).toBe('/atlas/42');
  });
});
