import { DestroyRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HeaderService } from './header.service';

/** A DestroyRef whose teardown we can fire by hand, standing in for a page. */
function fakeDestroyRef(): { ref: DestroyRef; destroy: () => void } {
  const callbacks: (() => void)[] = [];
  let destroyed = false;
  const ref = {
    get destroyed() {
      return destroyed;
    },
    onDestroy: (cb: () => void) => {
      callbacks.push(cb);
      return () => {
        const i = callbacks.indexOf(cb);
        if (i >= 0) callbacks.splice(i, 1);
      };
    },
  } as DestroyRef;
  return {
    ref,
    destroy: () => {
      destroyed = true;
      callbacks.slice().forEach((cb) => cb());
    },
  };
}

describe('HeaderService', () => {
  function service(): HeaderService {
    return TestBed.inject(HeaderService);
  }

  it('starts with no declarative content', () => {
    expect(service().content()).toBeNull();
  });

  it('exposes the content a page sets on activation', () => {
    const header = service();

    header.set({ eyebrow: 'Library', title: 'Your maps' }, fakeDestroyRef().ref);

    expect(header.content()).toEqual({ eyebrow: 'Library', title: 'Your maps' });
  });

  it('clears the content automatically when the page is destroyed', () => {
    const header = service();
    const page = fakeDestroyRef();
    header.set({ eyebrow: 'Library', title: 'Your maps' }, page.ref);

    page.destroy();

    expect(header.content()).toBeNull();
  });

  it("a superseded page's teardown does not clobber its successor", () => {
    const header = service();
    const first = fakeDestroyRef();
    const second = fakeDestroyRef();

    header.set({ title: 'Your maps' }, first.ref);
    header.set({ title: 'Sign in' }, second.ref);

    // The first page leaves after the second has already taken over: its
    // teardown must be ignored, leaving the second page's content in place.
    first.destroy();
    expect(header.content()).toEqual({ title: 'Sign in' });

    // The current owner leaving does clear it.
    second.destroy();
    expect(header.content()).toBeNull();
  });
});
