import { isTrackpadWheel, wheelDeltaPixels } from './wheel-gesture';

function wheel(props: Partial<WheelEvent>): WheelEvent {
  return {
    deltaX: 0,
    deltaY: 0,
    deltaMode: WheelEvent.DOM_DELTA_PIXEL,
    ctrlKey: false,
    metaKey: false,
    ...props,
  } as WheelEvent;
}

describe('wheel-gesture', () => {
  describe('wheelDeltaPixels', () => {
    it('passes a pixel-mode delta through unchanged', () => {
      expect(wheelDeltaPixels(120, wheel({ deltaMode: WheelEvent.DOM_DELTA_PIXEL }), 800)).toBe(120);
    });

    it('scales a line-mode delta by the line height', () => {
      expect(wheelDeltaPixels(3, wheel({ deltaMode: WheelEvent.DOM_DELTA_LINE }), 800)).toBe(48);
    });

    it('scales a page-mode delta by the page extent along the axis', () => {
      expect(wheelDeltaPixels(2, wheel({ deltaMode: WheelEvent.DOM_DELTA_PAGE }), 800)).toBe(1600);
    });
  });

  describe('isTrackpadWheel', () => {
    it('reads a small pixel delta as a trackpad stream', () => {
      expect(isTrackpadWheel(wheel({ deltaY: 8 }))).toBe(true);
    });

    it('reads a fractional pixel delta as a trackpad, even past the notch threshold', () => {
      expect(isTrackpadWheel(wheel({ deltaY: 53.5 }))).toBe(true);
    });

    it('reads a coarse integer notch as a mouse wheel', () => {
      expect(isTrackpadWheel(wheel({ deltaY: 100 }))).toBe(false);
    });

    it('treats any non-pixel delta as a mouse wheel', () => {
      expect(isTrackpadWheel(wheel({ deltaY: 3, deltaMode: WheelEvent.DOM_DELTA_LINE }))).toBe(false);
    });

    it('never mistakes a Cmd+wheel mouse for a trackpad', () => {
      expect(isTrackpadWheel(wheel({ deltaY: 4, metaKey: true }))).toBe(false);
    });
  });
});
