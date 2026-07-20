import {
  addElement,
  boardSurfaceSchema,
  BoxElement,
  bringForward,
  bringToFront,
  BoardSurface,
  emptyBoardSurface,
  ImageElement,
  pointSchema,
  removeElement,
  sendBackward,
  sendToBack,
  sizeSchema,
  stackingOrder,
} from './board-surface';

/** An Image element at the origin with `z` — the simplest element for geometry/z-order tests. */
const image = (id: string, z = 0): ImageElement => ({
  id,
  kind: 'image',
  assetUrl: `https://assets/${id}.png`,
  lockRatio: false,
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

  it('flows through the shared z-order helpers like any element', () => {
    let surface = addElement(addElement(emptyBoardSurface(), box('a')), box('b'));
    surface = bringToFront(surface, 'a');
    expect(stackingOrder(surface).map((e) => e.id)).toEqual(['b', 'a']);
  });
});

describe('geometry schemas reject non-finite values (data-loss guard)', () => {
  // A non-finite coordinate/extent survives in memory but `JSON.stringify(Infinity) === "null"`, so it
  // persists as `null` and fails the reload parse — the whole board would open empty (ADR-0062, #267).
  it('rejects a non-finite point', () => {
    expect(pointSchema.safeParse({ x: Infinity, y: 0 }).success).toBe(false);
    expect(pointSchema.safeParse({ x: 0, y: Number.NaN }).success).toBe(false);
    expect(pointSchema.safeParse({ x: 4, y: -6 }).success).toBe(true);
  });

  it('rejects a non-finite size', () => {
    expect(sizeSchema.safeParse({ width: Infinity, height: 10 }).success).toBe(false);
    expect(sizeSchema.safeParse({ width: 10, height: 20 }).success).toBe(true);
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

  it('removes an element, and is a no-op on an unknown id', () => {
    let surface = addElement(addElement(emptyBoardSurface(), image('a')), image('b'));
    surface = removeElement(surface, 'a');
    expect(surface.elements.map((element) => element.id)).toEqual(['b']);
    expect(removeElement(surface, 'missing')).toEqual(surface);
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

    it('returns the input document by reference when order and dense-z are already correct', () => {
      // A boundary action (bringToFront on the top element, sendToBack on the bottom) changes nothing;
      // the identical reference lets a caller (the store's commit) record no undo step / autosave.
      const surface = stacked('a', 'b', 'c');
      expect(bringToFront(surface, 'c')).toBe(surface);
      expect(sendToBack(surface, 'a')).toBe(surface);
      expect(bringForward(surface, 'c')).toBe(surface);
      expect(sendBackward(surface, 'a')).toBe(surface);
    });
  });
});
