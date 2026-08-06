import { Injector, createEnvironmentInjector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, throwError } from 'rxjs';
import { InboundLinkCount } from '@hexly/domain';
import { blastRadius } from './blast-radius';

/**
 * The blast radius a confirm states (ADR-0080, #414): still counting, counted, or could not count —
 * and never a refusal. One piece behind the unmount, the Container delete and the pack removal.
 */
describe('blastRadius', () => {
  function inScope(): { blast: ReturnType<typeof blastRadius>; destroy: () => void } {
    const injector = createEnvironmentInjector([], TestBed.inject(Injector) as never);
    return { blast: runInInjectionContext(injector, blastRadius), destroy: () => injector.destroy() };
  }

  it('reads a count, back to "still counting" first', () => {
    const { blast } = inScope();
    const counts = new Subject<InboundLinkCount>();

    blast.read(counts);
    expect(blast.count()).toBeNull();
    expect(blast.failed()).toBe(false);

    counts.next({ links: 4, worlds: 1 });
    expect(blast.count()).toEqual({ links: 4, worlds: 1 });
  });

  it('tells a failed count apart from a zero, so neither reads as the other', () => {
    const { blast } = inScope();

    blast.read(throwError(() => new Error('boom')));

    expect(blast.failed()).toBe(true);
    expect(blast.count()).toBeNull();
  });

  it('drops a superseded read, so it can never answer for the next confirm', () => {
    const { blast } = inScope();
    const first = new Subject<InboundLinkCount>();
    const second = new Subject<InboundLinkCount>();

    blast.read(first);
    blast.read(second);
    expect(first.observed).toBe(false);

    first.next({ links: 9, worlds: 3 });
    expect(blast.count()).toBeNull();
  });

  /**
   * Every consumer holds one as a component field, so an unanswered read has to go with the component:
   * navigating away from an open confirm must not leave a request writing into signals nobody reads.
   */
  it('tears down the read in flight when its owner is destroyed', () => {
    const { blast, destroy } = inScope();
    const counts = new Subject<InboundLinkCount>();

    blast.read(counts);
    expect(counts.observed).toBe(true);

    destroy();

    expect(counts.observed).toBe(false);
  });
});
