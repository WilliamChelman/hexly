import { Observable, Subject, filter } from 'rxjs';
import { FollowSignal, InterestRef } from '@hexly/domain';

/**
 * Spy-backed stand-in for {@link NudgeBusClient} (ADR-0044). `follow` is a spy returning the
 * ref's nudge stream (subscribing = declaring interest); {@link emit} pushes a nudge as if the
 * server sent one.
 */
export class MockNudgeBusClient {
  private readonly nudges = new Subject<FollowSignal>();

  readonly follow = vi.fn(
    (ref: InterestRef): Observable<FollowSignal> =>
      this.nudges.pipe(filter((n) => n.id === ref.id)),
  );

  /** Spy for the anonymous-principal switch — asserts a page connects/clears its token. */
  readonly useToken = vi.fn((_token: string | null): void => undefined);

  /** Test helper: deliver a follow signal (a `seq` delta, `unavailable` eviction, or `stale` pulse). */
  emit(nudge: FollowSignal): void {
    this.nudges.next(nudge);
  }
}
