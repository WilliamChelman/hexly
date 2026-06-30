import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthClient } from './auth.client';
import {
  makeUser,
  provideFakeTrailbase,
  restoredSession,
} from '../testing/fake-trailbase-client';

/**
 * The session contract the route guards depend on (ADR-0004, ADR-0032):
 * `sessionLoading` stays true until the boot revalidation settles, after which
 * `currentUser`/`isAuthenticated` reflect the live session. The TrailBase wire
 * itself is exercised end-to-end by the e2e suite; here the client is faked so
 * the orchestration is tested in isolation.
 */
describe('AuthClient session', () => {
  afterEach(() => localStorage.clear());

  function setup(seed?: { tokens: ReturnType<typeof restoredSession> }) {
    const tb = provideFakeTrailbase(seed);
    TestBed.configureTestingModule({ providers: [tb.provider, provideRouter([])] });
    const client = TestBed.inject(AuthClient);
    return { client, tb };
  }

  describe('with no restored session', () => {
    it('settles signed-out: sessionLoading false, currentUser null', () => {
      const { client } = setup();
      expect(client.sessionLoading()).toBe(false);
      expect(client.currentUser()).toBeNull();
      expect(client.isAuthenticated()).toBe(false);
    });
  });

  describe('with a session restored from storage', () => {
    it('trusts the restored JWT: signed in immediately, not loading', () => {
      const { client } = setup({ tokens: restoredSession('u1') });
      // The unexpired JWT is authority on boot (ADR-0032) — no server round-trip
      // to wait on, so guards see a settled, authenticated session at once.
      expect(client.currentUser()?.id).toBe('u1');
      expect(client.isAuthenticated()).toBe(true);
      expect(client.sessionLoading()).toBe(false);
    });

    it('signs out when the background revalidation finds the session revoked', () => {
      const { client, tb } = setup({ tokens: restoredSession('u1') });
      expect(client.isAuthenticated()).toBe(true);

      // TTL-bounded revocation: the background check downgrades us to signed-out.
      tb.client.emitBoot(undefined);

      expect(client.currentUser()).toBeNull();
      expect(client.sessionLoading()).toBe(false);
    });
  });

  describe('login / logout', () => {
    it('establishes the user on a successful login', async () => {
      const { client, tb } = setup();
      tb.client.nextLogin = { user: makeUser('u1', 'ada@hexly.test') };

      const user = await firstValueFrom(client.login('ada@hexly.test', 'pw'));

      expect(user.displayName).toBe('ada');
      expect(client.isAuthenticated()).toBe(true);
      expect(client.currentUser()?.id).toBe('u1');
    });

    it('rejects and stays signed-out on a bad login', async () => {
      const { client, tb } = setup();
      tb.client.nextLogin = { error: new Error('401') };

      await expect(firstValueFrom(client.login('ada@hexly.test', 'nope'))).rejects.toThrow();
      expect(client.isAuthenticated()).toBe(false);
    });

    it('clears the user on logout', async () => {
      const { client, tb } = setup();
      tb.client.nextLogin = { user: makeUser('u1') };
      await firstValueFrom(client.login('u1@test.com', 'pw'));

      await firstValueFrom(client.logout());

      expect(client.currentUser()).toBeNull();
    });
  });
});
