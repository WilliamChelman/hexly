import { emptyPlaneClickAction } from './board-canvas.component';

/**
 * The canvas's pointer plumbing (capture, drag threshold, camera) is exercised live; the click *policy*
 * it applies on release is the pure {@link emptyPlaneClickAction}, tested here.
 */
describe('emptyPlaneClickAction', () => {
  it('deselects under the Select Tool — the empty plane has nothing to pick', () => {
    expect(emptyPlaneClickAction('select', null, true)).toBe('deselect');
  });

  it('places under a placement Tool with nothing armed', () => {
    expect(emptyPlaneClickAction('box', null, true)).toBe('place');
    expect(emptyPlaneClickAction('text', null, true)).toBe('place');
    expect(emptyPlaneClickAction('image', null, true)).toBe('place');
    expect(emptyPlaneClickAction('embed', null, true)).toBe('place');
  });

  it('only deselects while an element is armed — click-away finishes it, it must not place the next one (#268)', () => {
    // The sticky Text cascade: tool stays 'text' and the fresh block is armed; clicking the plane to
    // finish typing must disarm, and only the click after that places again.
    expect(emptyPlaneClickAction('text', 'block-1', true)).toBe('deselect');
    expect(emptyPlaneClickAction('box', 'block-1', true)).toBe('deselect');
  });

  it('never places when the session is not writable — writability is live and can flip mid-session (ADR-0037)', () => {
    expect(emptyPlaneClickAction('box', null, false)).toBe('none');
    expect(emptyPlaneClickAction('text', null, false)).toBe('none');
  });

  it('still deselects read-only — selection is transient UI state, not a document mutation', () => {
    expect(emptyPlaneClickAction('select', null, false)).toBe('deselect');
    expect(emptyPlaneClickAction('text', 'block-1', false)).toBe('deselect');
  });
});
