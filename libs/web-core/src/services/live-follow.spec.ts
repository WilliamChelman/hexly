import { HttpErrorResponse } from '@angular/common/http';
import { Observable, Subject, of, throwError } from 'rxjs';
import { FollowSignal } from '@hexly/domain';
import { EVICTED, watchResource } from './live-follow';

describe('watchResource', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const DEBOUNCE = 10;

  function harness(
    fetch: () => Observable<string>,
    shouldRefetch?: (n: FollowSignal) => boolean,
    onTransientError?: (err: unknown) => void,
  ) {
    const follow = new Subject<FollowSignal>();
    const seen: unknown[] = [];
    const sub = watchResource({
      follow,
      fetch,
      debounceMs: DEBOUNCE,
      shouldRefetch,
      onTransientError,
    }).subscribe((r) => seen.push(r));
    return { follow, seen, sub };
  }

  it('refetches and emits the resource after the debounce on a readable nudge', () => {
    const fetch = vi.fn(() => of('DETAIL'));
    const { follow, seen } = harness(fetch);

    follow.next({ id: 'x', updatedAt: 2 });
    expect(fetch).not.toHaveBeenCalled(); // debounced

    vi.advanceTimersByTime(DEBOUNCE);
    expect(seen).toEqual(['DETAIL']);
  });

  it('emits EVICTED immediately on an unavailable nudge — no debounce, no fetch', () => {
    const fetch = vi.fn(() => of('DETAIL'));
    const { follow, seen } = harness(fetch);

    follow.next({ id: 'x', unavailable: true });

    expect(seen).toEqual([EVICTED]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('maps a 403/404 refetch to EVICTED (access gone)', () => {
    for (const status of [403, 404]) {
      const { follow, seen } = harness(() => throwError(() => new HttpErrorResponse({ status })));
      follow.next({ id: 'x', updatedAt: 2 });
      vi.advanceTimersByTime(DEBOUNCE);
      expect(seen).toEqual([EVICTED]);
    }
  });

  it('swallows a transient failure (5xx / 401 / network) and stays alive to heal on the next nudge', () => {
    for (const err of [
      new HttpErrorResponse({ status: 503 }),
      new HttpErrorResponse({ status: 401 }), // session expiry is NOT access loss
      new Error('network blip'),
    ]) {
      const fetch = vi
        .fn<() => Observable<string>>()
        .mockReturnValueOnce(throwError(() => err))
        .mockReturnValue(of('HEALED'));
      const { follow, seen } = harness(fetch);

      follow.next({ id: 'x', updatedAt: 2 });
      vi.advanceTimersByTime(DEBOUNCE);
      expect(seen).toEqual([]); // swallowed, not evicted

      follow.next({ id: 'x', updatedAt: 3 });
      vi.advanceTimersByTime(DEBOUNCE);
      expect(seen).toEqual(['HEALED']); // subscription survived
    }
  });

  it('reports a swallowed transient failure to onTransientError, but not access-loss', () => {
    const transient = new HttpErrorResponse({ status: 503 });
    const onTransientError = vi.fn();
    const fetch = vi
      .fn<() => Observable<string>>()
      .mockReturnValueOnce(throwError(() => transient))
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 404 })));
    const { follow } = harness(fetch, undefined, onTransientError);

    follow.next({ id: 'x', updatedAt: 2 });
    vi.advanceTimersByTime(DEBOUNCE);
    expect(onTransientError).toHaveBeenCalledWith(transient);

    follow.next({ id: 'x', updatedAt: 3 });
    vi.advanceTimersByTime(DEBOUNCE);
    expect(onTransientError).toHaveBeenCalledTimes(1); // 404 evicted, not reported as transient
  });

  it('never fetches a nudge the shouldRefetch gate rejects', () => {
    const fetch = vi.fn(() => of('DETAIL'));
    const { follow, seen } = harness(fetch, () => false);

    follow.next({ id: 'x', updatedAt: 2 });
    vi.advanceTimersByTime(DEBOUNCE);

    expect(fetch).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
  });
});
