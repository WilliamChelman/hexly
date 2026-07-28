import { LISTBOX_MAX_HEIGHT, placeListbox } from './listbox-placement';

describe('placeListbox', () => {
  const viewport = { width: 1000, height: 800 };

  it('hangs below the anchor when the space there holds the whole list', () => {
    const placement = placeListbox({ left: 120, top: 80, bottom: 100 }, 256, viewport);

    expect(placement).toEqual({ left: 120, top: 100, bottom: null, maxHeight: LISTBOX_MAX_HEIGHT });
  });

  it('flips above a caret near the bottom, pinning its bottom edge to the caret', () => {
    const placement = placeListbox({ left: 120, top: 700, bottom: 720 }, 256, viewport);

    expect(placement.top).toBeNull();
    // Bottom edge at the caret's top: 800 - 700.
    expect(placement.bottom).toBe(100);
    expect(placement.maxHeight).toBe(LISTBOX_MAX_HEIGHT);
  });

  it('caps its height to the space it flipped into, so a long list scrolls instead of bleeding off-screen', () => {
    const placement = placeListbox({ left: 120, top: 200, bottom: 780 }, 256, viewport);

    expect(placement.bottom).toBe(600);
    expect(placement.maxHeight).toBe(192); // 200 - 8 margin
  });

  it('caps its height below too, when neither side fits and below is the roomier one', () => {
    const placement = placeListbox({ left: 120, top: 20, bottom: 600 }, 256, viewport);

    expect(placement.top).toBe(600);
    expect(placement.maxHeight).toBe(192); // 800 - 600 - 8 margin
  });

  it('slides left only as far as needed to keep the box on screen', () => {
    const placement = placeListbox({ left: 900, top: 80, bottom: 100 }, 256, viewport);

    expect(placement.left).toBe(736); // 1000 - 256 - 8 margin
  });

  it('keeps the left margin when the viewport is narrower than the box itself', () => {
    const placement = placeListbox({ left: 40, top: 80, bottom: 100 }, 256, { width: 200, height: 800 });

    expect(placement.left).toBe(8);
  });
});
