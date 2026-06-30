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
import { MockAuthClient } from '../testing/auth-client.mock';

const ada = { id: 'u1', email: 'ada@hexly.test', displayName: 'Ada' };

function settle(result: unknown): Promise<boolean | UrlTree> {
  return isObservable(result)
    ? firstValueFrom(result as Observable<boolean | UrlTree>)
    : Promise.resolve(result as boolean | UrlTree);
}

describe('authGuard', () => {
  let auth: MockAuthClient;

  beforeEach(() => {
    auth = new MockAuthClient();
    TestBed.configureTestingModule({
      providers: [{ provide: AuthClient, useValue: auth }],
    });
  });

  function run(url = '/atlas/42') {
    return TestBed.runInInjectionContext(() =>
      authGuard(
        {} as ActivatedRouteSnapshot,
        { url } as RouterStateSnapshot,
      ),
    );
  }

  it('redirects to /login preserving the intended destination when there is no session', async () => {
    const value = await settle(run('/atlas/42'));
    expect(value).toBeInstanceOf(UrlTree);
    expect((value as UrlTree).toString()).toBe('/login?returnUrl=%2Fatlas%2F42');
  });

  it('allows activation when authenticated', async () => {
    auth.setUser(ada);
    expect(await settle(run())).toBe(true);
  });

  it('waits for the boot check to finish before allowing an authenticated user through', async () => {
    auth.setLoading(true);
    auth.setUser(ada);
    const resultPromise = settle(run());

    auth.setLoading(false);
    TestBed.flushEffects();

    expect(await resultPromise).toBe(true);
  });

  it('redirects after the boot check resolves to no session', async () => {
    auth.setLoading(true);
    const resultPromise = settle(run('/atlas/42'));

    auth.setLoading(false);
    TestBed.flushEffects();

    const value = await resultPromise;
    expect(value).toBeInstanceOf(UrlTree);
    expect((value as UrlTree).toString()).toBe('/login?returnUrl=%2Fatlas%2F42');
  });
});

describe('loginGuard', () => {
  let auth: MockAuthClient;

  beforeEach(() => {
    auth = new MockAuthClient();
    TestBed.configureTestingModule({
      providers: [{ provide: AuthClient, useValue: auth }],
    });
  });

  function run(returnUrl?: string) {
    const route = {
      queryParamMap: convertToParamMap(returnUrl ? { returnUrl } : {}),
    } as unknown as ActivatedRouteSnapshot;
    return TestBed.runInInjectionContext(() =>
      loginGuard(route, {} as RouterStateSnapshot),
    );
  }

  it('lets an unauthenticated user reach /login', async () => {
    expect(await settle(run())).toBe(true);
  });

  it('bounces an already-authenticated user to the editor', async () => {
    auth.setUser(ada);
    const value = await settle(run());
    expect(value).toBeInstanceOf(UrlTree);
    expect((value as UrlTree).toString()).toBe('/');
  });

  it('bounces an already-authenticated user to returnUrl when present', async () => {
    auth.setUser(ada);
    const value = await settle(run('/atlas/42'));
    expect(value).toBeInstanceOf(UrlTree);
    expect((value as UrlTree).toString()).toBe('/atlas/42');
  });

  it('waits for the boot check before redirecting an authenticated user', async () => {
    auth.setLoading(true);
    auth.setUser(ada);
    const resultPromise = settle(run('/atlas/42'));

    auth.setLoading(false);
    TestBed.flushEffects();

    const value = await resultPromise;
    expect(value).toBeInstanceOf(UrlTree);
    expect((value as UrlTree).toString()).toBe('/atlas/42');
  });
});
