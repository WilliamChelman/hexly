import { HttpErrorResponse } from '@angular/common/http';
import { EMPTY, Observable, catchError, debounceTime, filter, map, merge, of, share, switchMap } from 'rxjs';
import { FollowSignal, UnavailableNudge } from '@hexly/domain';

/**
 * The followed resource's access ended: an `unavailable` eviction nudge, or a refetch that
 * came back 403/404 (access gone across a gap).
 */
export const EVICTED = Symbol('evicted');
export type Evicted = typeof EVICTED;

/** What a live-follow `watch()` emits: a freshly-loaded resource, or {@link EVICTED}. */
export type Watched<T> = T | Evicted;

/** The inputs a client hands {@link watchResource}: the follow stream, its refetch, and its tuning. */
export interface WatchResource<T> {
  /** One resource's server nudge stream — a `bus.follow(ref)`. */
  follow: Observable<FollowSignal>;
  /** How to (re)load the resource once a nudge clears the gate. */
  fetch: () => Observable<T>;
  /** Trailing-debounce window so a burst of nudges coalesces into one refetch. */
  debounceMs: number;
  /** The caller's freshness/echo gate, checked at fire time; omit to always refetch. */
  shouldRefetch?: (n: FollowSignal) => boolean;
  /**
   * Notified when a refetch fails *transiently* (not access-loss) and is swallowed. Access-loss
   * (403/404) evicts instead and never calls this.
   */
  onTransientError?: (err: unknown) => void;
}

/**
 * The shared live-follow loop behind every client `watch()` (ADR-0044): relay one resource's
 * server nudges into a debounced refetch-and-emit, mapping eviction and access-loss to
 * {@link EVICTED}.
 *
 * `shouldRefetch` runs at *fire time*, after the debounce, since it reads live caller state. An
 * eviction jumps the debounce queue and reports at once. A transient refetch failure (5xx, a blip)
 * is swallowed rather than blanking a valid follow — the next nudge or reconnect heals it.
 */
export function watchResource<T>({
  follow,
  fetch,
  debounceMs,
  shouldRefetch = () => true,
  onTransientError,
}: WatchResource<T>): Observable<Watched<T>> {
  // One upstream follow for both branches (one interest acquisition), not two.
  const shared = follow.pipe(share());
  return merge(
    shared.pipe(
      filter((n): n is UnavailableNudge => 'unavailable' in n),
      map((): Evicted => EVICTED),
    ),
    shared.pipe(
      filter((n) => !('unavailable' in n)),
      debounceTime(debounceMs),
      filter(shouldRefetch),
      switchMap(() =>
        fetch().pipe(
          catchError((err): Observable<Watched<T>> => {
            if (isAccessLoss(err)) return of(EVICTED);
            onTransientError?.(err);
            return EMPTY;
          }),
        ),
      ),
    ),
  );
}

/**
 * Whether a failed refetch means access is *gone* — 403 Forbidden (a revoked grant / Public Link)
 * or 404 Not Found (deleted, or opaque-unreachable) — so the followed view should be evicted (#177).
 * A transient failure (5xx, network blip) is NOT access loss: it self-heals on the next nudge or
 * reconnect, so it must not blank a valid follow. Session expiry surfaces as **401** in this API
 * (never 403), so it is deliberately excluded — a cookie-refresh race must not evict.
 */
function isAccessLoss(err: unknown): boolean {
  return err instanceof HttpErrorResponse && (err.status === 403 || err.status === 404);
}
