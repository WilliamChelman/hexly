import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  convertToParamMap,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { firstValueFrom, isObservable, Observable } from 'rxjs';
import { AuthUser, DeploymentProfile } from '@hexly/domain';
import { authGuard, loginGuard, manageUsersGuard, superadminGuard } from './auth.guard';
import { AuthClient } from '../services/auth.client';
import { ClientConfigStore } from '../services/client-config.store';
import { MockAuthClient } from '../testing/auth-client.mock';
import { mockClientConfigStore } from '../testing/client-config-store.mock';

const ada: AuthUser = {
  id: 'u1',
  email: 'ada@hexly.test',
  displayName: 'Ada',
  preferences: {},
  roles: ['create-worlds'],
  isSuperadmin: false,
};
const userManager: AuthUser = { ...ada, roles: ['manage-users'] };
const superadmin: AuthUser = { ...ada, roles: [], isSuperadmin: true };

function settle(result: unknown): Promise<boolean | UrlTree> {
  // Helper to unify Observable and Promise guard results.
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
    return TestBed.runInInjectionContext(() => authGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot));
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

describe('manageUsersGuard', () => {
  let auth: MockAuthClient;

  beforeEach(() => {
    auth = new MockAuthClient();
    TestBed.configureTestingModule({
      providers: [{ provide: AuthClient, useValue: auth }],
    });
  });

  function run(url = '/users') {
    return TestBed.runInInjectionContext(() =>
      manageUsersGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
    );
  }

  it('redirects to /login when there is no session', async () => {
    const value = await settle(run());
    expect(value).toBeInstanceOf(UrlTree);
    expect((value as UrlTree).toString()).toBe('/login?returnUrl=%2Fusers');
  });

  it('bounces a signed-in user without the manage-users power to the root', async () => {
    auth.setUser(ada); // holds create-worlds only
    const value = await settle(run());
    expect(value).toBeInstanceOf(UrlTree);
    expect((value as UrlTree).toString()).toBe('/');
  });

  it('allows a user holding the manage-users role', async () => {
    auth.setUser(userManager);
    expect(await settle(run())).toBe(true);
  });

  it('allows a Superadmin, who supersedes every role', async () => {
    auth.setUser(superadmin);
    expect(await settle(run())).toBe(true);
  });
});

describe('superadminGuard', () => {
  let auth: MockAuthClient;

  beforeEach(() => {
    auth = new MockAuthClient();
    TestBed.configureTestingModule({
      providers: [{ provide: AuthClient, useValue: auth }],
    });
  });

  function run(url = '/admin') {
    return TestBed.runInInjectionContext(() =>
      superadminGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
    );
  }

  it('redirects to /login when there is no session', async () => {
    const value = await settle(run());
    expect(value).toBeInstanceOf(UrlTree);
    expect((value as UrlTree).toString()).toBe('/login?returnUrl=%2Fadmin');
  });

  it('bounces a mere user manager to the root', async () => {
    auth.setUser(userManager);
    const value = await settle(run());
    expect(value).toBeInstanceOf(UrlTree);
    expect((value as UrlTree).toString()).toBe('/');
  });

  it('allows a Superadmin', async () => {
    auth.setUser(superadmin);
    expect(await settle(run())).toBe(true);
  });
});

// Every case above runs without a ClientConfigStore override, so it reads the fall-open `server`
// profile — the login page with its return URL, exactly as before ADR-0071.
describe('the desktop profile has no login page to send anyone to (ADR-0071)', () => {
  let auth: MockAuthClient;

  beforeEach(() => {
    auth = new MockAuthClient();
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthClient, useValue: auth },
        {
          provide: ClientConfigStore,
          useValue: mockClientConfigStore({ profile: signal<DeploymentProfile>('desktop') }),
        },
      ],
    });
  });

  function run(guard: CanActivateFn, url: string) {
    return TestBed.runInInjectionContext(() => guard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot));
  }

  const guards: readonly [string, CanActivateFn][] = [
    ['authGuard', authGuard],
    ['manageUsersGuard', manageUsersGuard],
    ['superadminGuard', superadminGuard],
  ];

  for (const [name, guard] of guards) {
    it(`sends ${name} to the unrecoverable-session error, with no returnUrl to come back to`, async () => {
      const value = await settle(run(guard, '/atlas/42'));
      expect(value).toBeInstanceOf(UrlTree);
      expect((value as UrlTree).toString()).toBe('/session-error');
    });
  }

  it('still lets an authenticated user through — the Sole User has a genuine session (ADR-0070)', async () => {
    auth.setUser(superadmin);
    expect(await settle(run(authGuard, '/atlas/42'))).toBe(true);
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
    return TestBed.runInInjectionContext(() => loginGuard(route, {} as RouterStateSnapshot));
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
