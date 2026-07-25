import { inject, Injectable } from '@angular/core';
import { DESKTOP_BRIDGE } from './desktop-bridge';

/**
 * Re-minting the session where something can: in the Desktop App a 401 must be recoverable, since the login
 * page a browser falls back to has no password to type (ADR-0070). Gated on the bridge, so in a browser
 * {@link renew} answers `false` and the 401 stands.
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
   * request went out under: a 401 from an older session only needs the retry, since re-minting again would
   * revoke the session other retries carry — `openSoleUserSession` clears the Sole User's sessions before it
   * mints, which is also why concurrent callers share one round trip. A rejecting bridge resolves `false`
   * rather than throwing, leaving the caller's own 401 as the error.
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
