import { Observable, Subject, filter } from 'rxjs';
import { EntityNudge, InterestRef } from '@hexly/domain';

/**
 * Spy-backed stand-in for {@link NudgeBusClient} (ADR-0044). `follow` is a spy returning the
 * ref's nudge stream (subscribing = declaring interest); {@link emit} pushes a nudge as if the
 * server sent one.
 */
export class MockNudgeBusClient {
  private readonly nudges = new Subject<EntityNudge>();

  readonly follow = vi.fn(
    (ref: InterestRef): Observable<EntityNudge> =>
      this.nudges.pipe(filter((n) => n.id === ref.id)),
  );

  /** Test helper: deliver a nudge to followers. */
  emit(nudge: EntityNudge): void {
    this.nudges.next(nudge);
  }
}
