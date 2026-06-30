import { inject, Injectable, InjectionToken, signal } from '@angular/core';
import { initClient, type Client, type Tokens, type User } from 'trailbase';

/**
 * Where the auth + refresh tokens are stashed so a reload stays signed in.
 *
 * localStorage rather than an HttpOnly cookie: TrailBase's JSON login is
 * token-only (the cookie session is reachable only via its hosted auth UI, which
 * would replace Hexly's own login screen). The XSS tradeoff and its mitigation
 * are recorded in ADR-0032.
 */
const TOKENS_KEY = 'hexly.tb.session';

function readStoredTokens(): Tokens | undefined {
  try {
    const raw = localStorage.getItem(TOKENS_KEY);
    return raw ? (JSON.parse(raw) as Tokens) : undefined;
  } catch {
    return undefined;
  }
}

function persistTokens(tokens: Tokens | undefined): void {
  try {
    if (tokens) localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
    else localStorage.removeItem(TOKENS_KEY);
  } catch {
    /* private mode / no storage: the session simply won't survive a reload */
  }
}

/**
 * The low-level client constructor, injectable so tests can swap a fake without
 * standing up the real transport. Defaults to the real `initClient`.
 */
export type InitClient = typeof initClient;

export const TRAILBASE_INIT = new InjectionToken<InitClient>('trailbase-init-client', {
  providedIn: 'root',
  factory: () => initClient,
});

/**
 * The single TrailBase transport client (ADR-0032). Every consumer talks to the
 * same instance: {@link AuthClient} for the session today, and the Record APIs
 * for Entities/Worlds in slice #3 (`tb.client.records('entities')`). It owns
 * token persistence and exposes the authenticated user as a signal, so nobody
 * has to reach through `AuthClient` to get at the client.
 *
 * No base URL: TrailBase serves the SPA from the same origin (ADR-0008), so
 * relative `/api/...` requests reach it directly.
 */
@Injectable({ providedIn: 'root' })
export class TrailbaseClient {
  private readonly _user = signal<User | undefined>(undefined);
  /** Who the current token authenticates as, or undefined when signed out. */
  readonly user = this._user.asReadonly();

  readonly client: Client = inject(TRAILBASE_INIT)(undefined, {
    tokens: readStoredTokens(),
    // Fires on login, logout, and a background revalidation that found the
    // session revoked (the client skips it when revalidation merely confirms).
    onAuthChange: (client, user) => {
      persistTokens(client.tokens());
      this._user.set(user);
    },
  });

  constructor() {
    // The client decodes the stored JWT synchronously but skips onAuthChange on a
    // successful restore, so seed the signal from it here.
    this._user.set(this.client.user());
  }
}
