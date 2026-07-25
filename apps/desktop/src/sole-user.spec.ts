import { INSTANCE_ROLES } from '@hexly/domain';
import { closeSoleUserSession, NO_EXPIRY, openSoleUserSession, SoleUserAuth } from './sole-user';

/** Records what main asks of the API's auth service, standing in for a real `users`/`sessions` table. */
class FakeAuth implements SoleUserAuth {
  readonly seeded: { email: string; password: string; displayName: string; opts: unknown }[] = [];
  readonly minted: { userId: string; expiresAt?: number }[] = [];
  readonly loggedOutUsers: string[] = [];
  readonly revokedTokens: (string | undefined)[] = [];
  private users = new Map<string, string>();
  private nextToken = 0;

  findUserIdByEmail(email: string): string | undefined {
    return this.users.get(email);
  }

  async seedUser(
    email: string,
    password: string,
    displayName: string,
    opts: { roles?: readonly string[]; isSuperadmin?: boolean } = {},
  ): Promise<string> {
    this.seeded.push({ email, password, displayName, opts });
    const id = `user-${this.seeded.length}`;
    this.users.set(email, id);
    return id;
  }

  mintSession(userId: string, opts: { expiresAt?: number } = {}): string {
    this.minted.push({ userId, expiresAt: opts.expiresAt });
    return `token-${++this.nextToken}`;
  }

  async logoutAll(userId: string): Promise<void> {
    this.loggedOutUsers.push(userId);
  }

  async logout(token: string | undefined): Promise<void> {
    this.revokedTokens.push(token);
  }
}

describe("the Desktop App's Sole User session", () => {
  it('seeds one real row holding Superadmin and every Instance Role', async () => {
    const auth = new FakeAuth();

    await openSoleUserSession(auth);

    expect(auth.seeded).toHaveLength(1);
    expect(auth.seeded[0].opts).toEqual({ isSuperadmin: true, roles: [...INSTANCE_ROLES] });
  });

  it('gives it a password nobody knows, and a different one each time it is provisioned', async () => {
    const first = new FakeAuth();
    const second = new FakeAuth();

    await openSoleUserSession(first);
    await openSoleUserSession(second);

    expect(first.seeded[0].password.length).toBeGreaterThanOrEqual(32);
    expect(first.seeded[0].password).not.toBe(second.seeded[0].password);
  });

  it('reuses the row on a second launch instead of seeding again', async () => {
    const auth = new FakeAuth();

    await openSoleUserSession(auth);
    await openSoleUserSession(auth);

    expect(auth.seeded).toHaveLength(1);
    expect(auth.minted.map((m) => m.userId)).toEqual(['user-1', 'user-1']);
  });

  it('mints a session that never expires, since there is no password to renew it with', async () => {
    const auth = new FakeAuth();

    const token = await openSoleUserSession(auth);

    expect(token).toBe('token-1');
    expect(auth.minted).toEqual([{ userId: 'user-1', expiresAt: NO_EXPIRY }]);
  });

  it('clears the sessions a previous launch left before minting its own', async () => {
    const auth = new FakeAuth();

    await openSoleUserSession(auth);

    expect(auth.loggedOutUsers).toEqual(['user-1']);
  });

  it('revokes the launch session on quit', async () => {
    const auth = new FakeAuth();
    const token = await openSoleUserSession(auth);

    await closeSoleUserSession(auth, token);

    expect(auth.revokedTokens).toEqual([token]);
  });
});
