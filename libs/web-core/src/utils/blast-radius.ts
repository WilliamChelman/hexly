import { Signal, signal } from '@angular/core';
import { Observable, Subscription } from 'rxjs';
import { InboundLinkCount } from '@hexly/domain';

/**
 * The reading of a **blast radius** while a confirm is open (ADR-0080, #414) — the tri-state every
 * surface that states one shows: still counting, counted, or could not count. One piece rather than
 * three, since unmounting a Container, deleting one and removing a pack all ask the same question and
 * all answer it the same way: a count that would not load degrades to a confirm without one, never to
 * a refusal.
 */
export interface BlastRadius {
  /** The count, or null while it is still being read. */
  readonly count: Signal<InboundLinkCount | null>;
  /** Whether that read failed — told apart from "still loading", so neither reads as zero. */
  readonly failed: Signal<boolean>;
  /**
   * Ask what the act would break, back to "still counting" first. Read per act rather than with the
   * list, so a co-author's save between opening the surface and pressing the button cannot make a
   * stated count a lie — and a superseded read is dropped, so it can never answer for the next confirm.
   */
  read(count$: Observable<InboundLinkCount>): void;
}

/** @see BlastRadius */
export function blastRadius(): BlastRadius {
  const count = signal<InboundLinkCount | null>(null);
  const failed = signal(false);
  let inFlight: Subscription | undefined;
  return {
    count: count.asReadonly(),
    failed: failed.asReadonly(),
    read(count$) {
      inFlight?.unsubscribe();
      count.set(null);
      failed.set(false);
      inFlight = count$.subscribe({ next: (blast) => count.set(blast), error: () => failed.set(true) });
    },
  };
}
