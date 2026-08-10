import { Observable, Subject, filter } from 'rxjs';
import { FollowSignal, InterestRef } from '@hexly/domain';

/** Spy-backed stand-in for {@link NudgeBusClient}. */
export class MockNudgeBusClient {
  private readonly nudges = new Subject<FollowSignal>();

  readonly follow = vi.fn(
    (ref: InterestRef): Observable<FollowSignal> => this.nudges.pipe(filter((n) => n.id === ref.id)),
  );

  /** Test helper: deliver a follow signal (a `seq` delta, `unavailable` eviction, or `stale` pulse). */
  emit(nudge: FollowSignal): void {
    this.nudges.next(nudge);
  }
}
