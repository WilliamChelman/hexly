import { Provider } from '@angular/core';
import type { Client, ClientOptions, MultiFactorAuthToken, Tokens, User } from 'trailbase';
import { InitClient, TRAILBASE_INIT } from '../services/trailbase-client';

/** Minimal opaque tokens — only the presence of a `refresh_token` is read. */
function tokensFor(user: User | undefined): Tokens | undefined {
  return user
    ? { auth_token: `auth-${user.id}`, refresh_token: `refresh-${user.id}`, csrf_token: null }
    : undefined;
}

/**
 * A drivable stand-in for the subset of the TrailBase {@link Client} that the
 * session layer uses, so `TrailbaseClient`/`AuthClient` can be tested without the
 * real transport (the wire is covered by the e2e suite). Mirrors the real client:
 * it does NOT fire `onAuthChange` at construction; login/logout/the boot
 * revalidation do. Provided via {@link provideFakeTrailbase} and cast to `Client`
 * (the unused methods aren't faked).
 */
export class FakeTrailbaseClient {
  private readonly onAuthChange?: (client: Client, user?: User) => void;
  private _tokens?: Tokens;
  private _user?: User;

  /** Outcome of the next `login()` — a user to establish, or an error to throw. */
  nextLogin: { user: User } | { error: unknown } = {
    error: new Error('FakeTrailbaseClient.nextLogin not configured'),
  };

  constructor(opts?: ClientOptions) {
    this.onAuthChange = opts?.onAuthChange;
    if (opts?.tokens) {
      this._tokens = opts.tokens;
      // A restored session exposes its (stale) user synchronously, awaiting the
      // boot revalidation the test drives via emitBoot().
      this._user = restoredUser(opts.tokens);
    }
  }

  tokens(): Tokens | undefined {
    return this._tokens;
  }

  user(): User | undefined {
    return this._user;
  }

  async login(): Promise<MultiFactorAuthToken | undefined> {
    if ('error' in this.nextLogin) throw this.nextLogin.error;
    this.establish(this.nextLogin.user);
    return undefined;
  }

  async logout(): Promise<boolean> {
    this.establish(undefined);
    return true;
  }

  async refreshAuthToken(): Promise<void> {
    /* no-op: boot revalidation is driven explicitly via emitBoot() */
  }

  /** Simulate the background boot revalidation settling on a user (or signed-out). */
  emitBoot(user: User | undefined): void {
    this.establish(user);
  }

  private establish(user: User | undefined): void {
    this._user = user;
    this._tokens = tokensFor(user);
    this.onAuthChange?.(this as unknown as Client, user);
  }
}

/** A restored session carries a user; the id is encoded in the fake refresh token. */
function restoredUser(tokens: Tokens): User | undefined {
  const id = tokens.refresh_token?.replace(/^refresh-/, '');
  return id ? makeUser(id) : undefined;
}

/** Tokens for a restored session whose user id the fake can recover on boot. */
export function restoredSession(id: string): Tokens {
  return { auth_token: `auth-${id}`, refresh_token: `refresh-${id}`, csrf_token: null };
}

export function makeUser(id: string, email = `${id}@test.com`): User {
  return { id, email, username: null };
}

/**
 * Provide a single {@link FakeTrailbaseClient} as the low-level client and hand
 * it back so the test can drive logins/logouts and the boot revalidation. Pass
 * `tokens` to simulate a session restored from storage (the boot settles
 * immediately; the test then drives revocation via `client.emitBoot(undefined)`).
 *
 * The fake is created when `TrailbaseClient` is constructed, so read `.client`
 * after injection, not by destructuring up front.
 */
export function provideFakeTrailbase(seed?: { tokens?: Tokens }): {
  readonly provider: Provider;
  readonly client: FakeTrailbaseClient;
} {
  let client!: FakeTrailbaseClient;
  const init: InitClient = (_site, opts) =>
    (client = new FakeTrailbaseClient({ ...(opts as ClientOptions), ...seed })) as unknown as Client;
  return {
    provider: { provide: TRAILBASE_INIT, useValue: init },
    get client() {
      return client;
    },
  };
}
