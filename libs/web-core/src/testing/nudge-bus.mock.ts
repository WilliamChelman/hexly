import { Observable, Subject, filter } from 'rxjs';
import { InterestRef, NudgeEntry } from '@hexly/domain';

/**
 * Spy-backed stand-in for {@link NudgeBusClient} (ADR-0044). `follow` is a spy returning the
 * ref's nudge stream (subscribing = declaring interest); {@link emit} pushes a nudge as if the
 * server sent one.
 */
export class MockNudgeBusClient {
  private readonly nudges = new Subject<NudgeEntry>();

  readonly follow = vi.fn(
    (ref: InterestRef): Observable<NudgeEntry> =>
      this.nudges.pipe(filter((n) => n.id === ref.id)),
  );

  /** Spy for the anonymous-principal switch — asserts a page connects/clears its token. */
  readonly useToken = vi.fn((_token: string | null): void => undefined);

  /** Test helper: deliver a nudge (a version delta or an `unavailable` eviction) to followers. */
  emit(nudge: NudgeEntry): void {
    this.nudges.next(nudge);
  }
}
