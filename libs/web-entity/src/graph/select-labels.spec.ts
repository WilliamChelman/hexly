import { WorldGraph } from '@hexly/domain';
import { graphPayload } from './graph-payload';
import { selectLabels } from './select-labels';

/** A World of `nodes`, linked by `edges` given as `'source>target'` or `'source-descriptor>target'`. */
function world(nodes: string[], edges: string[] = []): WorldGraph {
  return {
    nodes: nodes.map((name) => ({ id: name, name, types: ['core.type.note'] })),
    edges: edges.map((e) => {
      const [left, target] = e.split('>');
      const [source, descriptor] = left.split('-');
      return { source, target, descriptor: descriptor ?? null, decor: false };
    }),
  };
}

/** Space positions, keyed by node name, in the payload's (degree-ordered) index order. */
function positionsOf(payload: ReturnType<typeof graphPayload>, at: Record<string, [number, number]>) {
  const xy = new Float32Array(payload.nodes.length * 2);
  payload.nodes.forEach((n, i) => {
    const [x, y] = at[n.name];
    xy[i * 2] = x;
    xy[i * 2 + 1] = y;
  });
  return xy;
}

// `sparse: 0` keeps the election under test; the sparse bypass has its own tests below.
const GRID = { pointCell: 100, linkCell: 100, max: 100, sparse: 0 };
/** One screen pixel per unit of space, viewport covering 0..1000. */
const VIEW = { scale: 1, minX: 0, minY: 0, maxX: 1000, maxY: 1000 };

describe('selectLabels', () => {
  it('labels the higher-degree node when two would collide in one cell', () => {
    const payload = graphPayload(world(['Hub', 'Orphan', 'Far'], ['Hub>Far']));
    // Hub and Orphan sit 10 units apart — well inside one 100px cell.
    const positions = positionsOf(payload, {
      Hub: [500, 500],
      Orphan: [510, 500],
      Far: [900, 900],
    });

    const { points } = selectLabels(payload, positions, VIEW, GRID);

    expect(points.map((i) => payload.nodes[i].name).sort()).toEqual(['Far', 'Hub']);
  });

  /**
   * cosmos.gl's own sampling grid is anchored to the *screen*, so a pan slides every node across
   * cell boundaries, re-elects every cell, and labels flicker. This grid is anchored in graph space:
   * the chosen set is a property of the World, not the camera. A half-cell pan is exactly where a
   * screen grid re-elects.
   */
  it('chooses the same labels no matter where the viewport is panned', () => {
    const payload = graphPayload(
      world(['Hub', 'Spoke', 'Neighbour', 'Orphan'], ['Hub>Spoke', 'Hub>Neighbour', 'Spoke>Neighbour']),
    );
    const positions = positionsOf(payload, {
      Hub: [140, 140],
      Spoke: [160, 150],
      Neighbour: [420, 380],
      Orphan: [700, 640],
    });
    const chosen = (view: typeof VIEW) =>
      selectLabels(payload, positions, view, GRID)
        .points.map((i) => payload.nodes[i].name)
        .sort();

    const origin = chosen(VIEW);
    expect(origin).toEqual(['Hub', 'Neighbour', 'Orphan']); // Spoke loses Hub's cell

    // Every pan keeps all four nodes (x,y ∈ 140..700) inside the viewport, so any change in the
    // result would be the grid re-electing, not a node scrolling out of frame.
    for (const [dx, dy] of [
      [50, 0],
      [0, 50],
      [50, 50],
      [100, 100],
      [-63, 120],
    ]) {
      expect(
        chosen({
          ...VIEW,
          minX: VIEW.minX + dx,
          maxX: VIEW.maxX + dx,
          minY: VIEW.minY + dy,
          maxY: VIEW.maxY + dy,
        }),
      ).toEqual(origin);
    }
  });

  /** Election runs over every node, visible or not; only the draw is culled to the viewport. */
  it('drops labels that pan off screen without promoting the node that lost their cell', () => {
    const payload = graphPayload(world(['Hub', 'Spoke', 'Far'], ['Hub>Far', 'Hub>Spoke']));
    const positions = positionsOf(payload, {
      Hub: [140, 140],
      Spoke: [160, 150],
      Far: [800, 800],
    });

    const panned = selectLabels(payload, positions, { ...VIEW, minX: 400, minY: 400 }, GRID);

    expect(panned.points.map((i) => payload.nodes[i].name)).toEqual(['Far']);
  });

  describe('Link Descriptors', () => {
    it('labels a link at its midpoint, on the same space-anchored grid', () => {
      const payload = graphPayload(world(['Ealdred', 'Mira'], ['Ealdred-spouse>Mira']));
      const positions = positionsOf(payload, {
        Ealdred: [400, 400],
        Mira: [600, 400],
      });

      const { links } = selectLabels(payload, positions, VIEW, GRID);

      expect(links.map((i) => payload.descriptors[i])).toEqual(['spouse']);
    });

    /** A descriptor-less link has nothing to draw, so it must not contend for a cell at all. */
    it('never lets a descriptor-less link take a cell from one that has a label', () => {
      const payload = graphPayload(
        world(['Hub', 'A', 'B'], ['Hub>A', 'Hub-rules>B']), // Hub>A is bare, and Hub is the heavier end
      );
      // Both midpoints land in the same cell, so exactly one link may be labelled.
      const positions = positionsOf(payload, {
        Hub: [500, 500],
        A: [520, 500],
        B: [500, 520],
      });

      const { links } = selectLabels(payload, positions, VIEW, GRID);

      expect(links.map((i) => payload.descriptors[i])).toEqual(['rules']);
    });
  });

  /**
   * The declutter's off-switch: a sparse view — a Local Graph at depth 1, a deep zoom — has room
   * for every name, so the cell election (which can drop a neighbour by anchor accident) is skipped.
   */
  describe('sparse views', () => {
    it('labels every visible node when few enough are in view, even cell-sharing ones', () => {
      const payload = graphPayload(world(['Hub', 'Orphan', 'Far'], ['Hub>Far']));
      // Hub and Orphan share a cell — the election would drop Orphan; the sparse bypass must not.
      const positions = positionsOf(payload, {
        Hub: [500, 500],
        Orphan: [510, 500],
        Far: [900, 900],
      });

      const { points } = selectLabels(payload, positions, VIEW, { ...GRID, sparse: 30 });

      expect(points.map((i) => payload.nodes[i].name).sort()).toEqual(['Far', 'Hub', 'Orphan']);
    });

    it('still culls to the viewport, and past the threshold the election resumes', () => {
      const payload = graphPayload(world(['Hub', 'Orphan', 'Far'], ['Hub>Far']));
      const positions = positionsOf(payload, {
        Hub: [500, 500],
        Orphan: [510, 500],
        Far: [1200, 1200], // off screen: sparse or not, an invisible node draws nothing
      });

      // Two visible nodes, threshold 2: sparse path, both labelled, Far culled.
      const sparse = selectLabels(payload, positions, VIEW, { ...GRID, sparse: 2 });
      expect(sparse.points.map((i) => payload.nodes[i].name).sort()).toEqual(['Hub', 'Orphan']);

      // Threshold 1: back to the election — Orphan loses Hub's cell again.
      const elected = selectLabels(payload, positions, VIEW, { ...GRID, sparse: 1 });
      expect(elected.points.map((i) => payload.nodes[i].name)).toEqual(['Hub']);
    });
  });

  /** The crowd the label layer's opacity follows: every node in the box counts, labelled or not. */
  it('counts every node inside the viewport, not just the labelled ones', () => {
    const payload = graphPayload(world(['Hub', 'Orphan', 'Far'], ['Hub>Far']));
    const positions = positionsOf(payload, {
      Hub: [500, 500],
      Orphan: [510, 500], // shares Hub's cell, so it is never labelled — still part of the crowd
      Far: [1200, 1200], // off screen: labelled or not, it is no part of the crowd
    });

    expect(selectLabels(payload, positions, VIEW, GRID).visiblePoints).toBe(2);
  });

  /** Zoom *should* change it: a cell covers less World, so labels that lost a collision now fit. */
  it('reveals more labels as the view zooms in', () => {
    const payload = graphPayload(world(['Hub', 'Spoke'], ['Hub>Spoke']));
    const positions = positionsOf(payload, {
      Hub: [500, 500],
      Spoke: [530, 500],
    });

    // At 1 px/unit the two sit in one 100px cell; at 8 px/unit the cell covers 12.5 units.
    expect(selectLabels(payload, positions, VIEW, GRID).points).toHaveLength(1);
    expect(selectLabels(payload, positions, { ...VIEW, scale: 8 }, GRID).points).toHaveLength(2);
  });
});
