import { inject, Injectable } from '@angular/core';
import { DESKTOP_BRIDGE } from './desktop-bridge';

/**
 * Re-minting the session, wherever something can. In the Desktop App a 401 is recoverable rather than
 * fatal, and must be: the login page a browser falls back to is a dead end with no password to type
 * (ADR-0070). Gated on the bridge, so in a browser {@link renew} answers `false` and the 401 stands.
 */
@Injectable({ providedIn: 'root' })
export class SessionRenewal {
  private readonly bridge = inject(DESKTOP_BRIDGE);
  private inFlight?: Promise<boolean>;
  private renewals = 0;

  /** Which session a request is about to be issued under — see {@link renew}. */
  get generation(): number {
    return this.renewals;
  }

  /**
   * Re-mint, resolving `true` when a retry is worth making. `since` is the {@link generation} the failed
   * request went out under: a 401 from before the current session only needs the retry, because someone
   * else has already re-minted. Re-minting again would revoke the session their retries are carrying —
   * `openSoleUserSession` clears the Sole User's sessions before it mints. Truly concurrent callers share
   * one round trip for the same reason.
   *
   * A bridge that rejects resolves `false` rather than throwing: the caller's own 401 is the honest error
   * to report, not the failure to paper over it.
   */
  renew(since: number): Promise<boolean> {
    if (!this.bridge) return Promise.resolve(false);
    if (since < this.renewals) return Promise.resolve(true);
    this.inFlight ??= this.bridge.renewSession().then(
      () => this.settle(true),
      () => this.settle(false),
    );
    return this.inFlight;
  }

  /** Release the shared round trip as it resolves, counting a success so older 401s know of it. */
  private settle(renewed: boolean): boolean {
    this.inFlight = undefined;
    if (renewed) this.renewals++;
    return renewed;
  }
}
