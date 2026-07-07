import { computed, Injectable, signal } from '@angular/core';
import { defer, finalize, MonoTypeOperatorFunction } from 'rxjs';

/**
 * How strongly the shell signals that work is in flight:
 * - `full` — a blocking curtain (e.g. a language switch, which re-renders the
 *   whole UI and may pull an uncached catalog);
 * - `subtle` — a discreet corner marker that leaves the page usable (e.g. a list
 *   fetch, an entity load, a save);
 * - `none` — nothing in flight.
 */
export type LoadingLevel = 'full' | 'subtle' | 'none';

/** Pages set this to hide the nav rail and global chrome (e.g. the login screen). */
@Injectable({ providedIn: 'root' })
export class AppShellStore {
  readonly standalone = signal(false);

  // Outstanding claims per level; counted (not a single flag) so two overlapping
  // loads can't clear each other early — the level holds until the last settles.
  private readonly full = signal(0);
  private readonly subtle = signal(0);

  /** The strongest level currently claimed — `full` outranks `subtle` outranks `none`. */
  readonly loading = computed<LoadingLevel>(() =>
    this.full() > 0 ? 'full' : this.subtle() > 0 ? 'subtle' : 'none',
  );

  /**
   * Raise `level` for one operation; the returned fn lowers it. Idempotent so a
   * double-call (e.g. error then unsubscribe) can't drive the count negative.
   */
  beginLoading(level: 'full' | 'subtle'): () => void {
    const counter = level === 'full' ? this.full : this.subtle;
    counter.update((n) => n + 1);
    let lowered = false;
    return () => {
      if (lowered) return;
      lowered = true;
      counter.update((n) => n - 1);
    };
  }

  /** RxJS sugar: hold `level` for the lifetime of the subscription. */
  withLoading<T>(level: 'full' | 'subtle'): MonoTypeOperatorFunction<T> {
    return (source) =>
      defer(() => {
        const end = this.beginLoading(level);
        return source.pipe(finalize(end));
      });
  }
}
