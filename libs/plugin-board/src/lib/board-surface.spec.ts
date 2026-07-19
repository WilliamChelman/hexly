import {
  addElement,
  boardSurfaceSchema,
  BoxElement,
  bringForward,
  bringToFront,
  BoardSurface,
  emptyBoardSurface,
  ImageElement,
  moveElement,
  removeElement,
  resizeElement,
  sendBackward,
  sendToBack,
  stackingOrder,
} from './board-surface';

/** An Image element at the origin with `z` — the simplest element for geometry/z-order tests. */
const image = (id: string, z = 0): ImageElement => ({
  id,
  kind: 'image',
  assetUrl: `https://assets/${id}.png`,
  position: { x: 0, y: 0 },
  size: { width: 10, height: 10 },
  z,
});

/** The ids in bottom→top stacking order. */
const order = (surface: BoardSurface): string[] => stackingOrder(surface).map((element) => element.id);

/** A minimal Box element — the Seam B minimal static element (#267). */
const box = (id: string, z = 0): BoxElement => ({
  id,
  kind: 'box',
  position: { x: 0, y: 0 },
  size: { width: 10, height: 10 },
  z,
});

describe('Box element (minimal static element, #267)', () => {
  it('round-trips through the surface schema as a discriminated-union member', () => {
    const surface = addElement(emptyBoardSurface(), box('a'));
    const parsed = boardSurfaceSchema.safeParse(surface);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.elements[0].kind).toBe('box');
  });

  it('flows through the shared geometry and z-order helpers like any element', () => {
    let surface = addElement(addElement(emptyBoardSurface(), box('a')), box('b'));
    surface = moveElement(surface, 'a', { x: 4, y: 6 });
    surface = resizeElement(surface, 'a', { width: 30, height: 40 });
    expect(stackingOrder(surface).map((e) => e.id)).toEqual(['a', 'b']);
    const a = surface.elements.find((e) => e.id === 'a');
    expect(a?.position).toEqual({ x: 4, y: 6 });
    expect(a?.size).toEqual({ width: 30, height: 40 });
  });
});

describe('Board element helpers (#263)', () => {
  it('adds an element on top of the stack (user story 21)', () => {
    let surface = addElement(emptyBoardSurface(), image('a'));
    surface = addElement(surface, image('b'));
    surface = addElement(surface, image('c'));
    // Insertion order is preserved in the array; z stamps each above the last, so c sits on top.
    expect(surface.elements.map((element) => element.id)).toEqual(['a', 'b', 'c']);
    expect(order(surface)).toEqual(['a', 'b', 'c']);
    expect(surface.elements[2].z).toBeGreaterThan(surface.elements[1].z);
  });

  it("ignores an incoming element's z, stamping it on top instead", () => {
    let surface = addElement(emptyBoardSurface(), image('a'));
    surface = addElement(surface, image('b', -99));
    expect(order(surface)).toEqual(['a', 'b']);
  });

  it('moves and resizes an element, leaving others untouched', () => {
    let surface = addElement(addElement(emptyBoardSurface(), image('a')), image('b'));
    surface = moveElement(surface, 'a', { x: 5, y: 7 });
    surface = resizeElement(surface, 'a', { width: 20, height: 30 });
    const a = surface.elements.find((element) => element.id === 'a');
    const b = surface.elements.find((element) => element.id === 'b');
    expect(a?.position).toEqual({ x: 5, y: 7 });
    expect(a?.size).toEqual({ width: 20, height: 30 });
    expect(b?.position).toEqual({ x: 0, y: 0 });
  });

  it('removes an element, and is a no-op on an unknown id', () => {
    let surface = addElement(addElement(emptyBoardSurface(), image('a')), image('b'));
    surface = removeElement(surface, 'a');
    expect(surface.elements.map((element) => element.id)).toEqual(['b']);
    expect(removeElement(surface, 'missing')).toEqual(surface);
  });

  it('is a no-op when moving/resizing an unknown id', () => {
    const surface = addElement(emptyBoardSurface(), image('a'));
    expect(moveElement(surface, 'missing', { x: 1, y: 1 })).toEqual(surface);
    expect(resizeElement(surface, 'missing', { width: 1, height: 1 })).toEqual(surface);
  });

  describe('z-order reordering', () => {
    /** A surface with elements a (bottom) … through the given ids (top), each one z above the last. */
    const stacked = (...ids: string[]): BoardSurface =>
      ids.reduce((surface, id) => addElement(surface, image(id)), emptyBoardSurface());

    it('brings an element forward one step, and no-ops at the top', () => {
      const surface = stacked('a', 'b', 'c');
      expect(order(bringForward(surface, 'a'))).toEqual(['b', 'a', 'c']);
      expect(order(bringForward(surface, 'c'))).toEqual(['a', 'b', 'c']);
    });

    it('sends an element backward one step, and no-ops at the bottom', () => {
      const surface = stacked('a', 'b', 'c');
      expect(order(sendBackward(surface, 'c'))).toEqual(['a', 'c', 'b']);
      expect(order(sendBackward(surface, 'a'))).toEqual(['a', 'b', 'c']);
    });

    it('brings an element to the very front and sends one to the very back', () => {
      const surface = stacked('a', 'b', 'c', 'd');
      expect(order(bringToFront(surface, 'a'))).toEqual(['b', 'c', 'd', 'a']);
      expect(order(sendToBack(surface, 'd'))).toEqual(['d', 'a', 'b', 'c']);
    });

    it('renumbers z to a dense 0-based sequence so repeated reorders never drift', () => {
      const surface = bringToFront(stacked('a', 'b', 'c'), 'a');
      expect([...surface.elements].map((element) => element.z).sort((x, y) => x - y)).toEqual([0, 1, 2]);
    });

    it('is a no-op on an unknown id', () => {
      const surface = stacked('a', 'b');
      expect(bringForward(surface, 'missing')).toEqual(surface);
      expect(sendToBack(surface, 'missing')).toEqual(surface);
    });
  });
});
