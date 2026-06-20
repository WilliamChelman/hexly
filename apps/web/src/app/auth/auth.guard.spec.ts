import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { firstValueFrom, isObservable, Observable } from 'rxjs';
import { authGuard } from './auth.guard';
import { AuthStore } from './auth.store';

describe('authGuard', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  /** Invoke the functional guard the way the router would. */
  function run() {
    return TestBed.runInInjectionContext(() =>
      authGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );
  }

  it('redirects to /login when there is no session', async () => {
    const result = run();
    // firstValueFrom subscribes synchronously, issuing the /auth/me request.
    const settled = isObservable(result)
      ? firstValueFrom(result as Observable<boolean | UrlTree>)
      : Promise.resolve(result);

    http
      .expectOne('/auth/me')
      .flush(null, { status: 401, statusText: 'Unauthorized' });

    const value = await settled;
    expect(value).toBeInstanceOf(UrlTree);
    expect((value as UrlTree).toString()).toBe('/login');
  });

  it('allows activation once the user is authenticated', () => {
    const store = TestBed.inject(AuthStore);
    store.login('ada@hexly.test', 'pw').subscribe();
    http.expectOne('/auth/login').flush({
      id: 'u1',
      email: 'ada@hexly.test',
      displayName: 'Ada',
    });

    // Already authenticated: the guard resolves without touching the network.
    expect(run()).toBe(true);
    http.expectNone('/auth/me');
  });
});
