import { LinkedEntity } from '@hexly/domain';
import { GraphPayload } from './graph-payload';

/** cosmos.gl's fixed simulation space. Anything larger crashes iOS; it caps at 4096. */
export const SPACE = 4096;

/** The radius a fresh point is seeded at: a ring, so the simulation has somewhere to push from. */
const SEED_RING = 500;

/**
 * How much bigger the centre Entity draws, in the same units as the degree-derived base size — enough
 * that "the Entity this graph is about" reads at a glance in a panel-sized Local Graph (ADR-0072),
 * without the hub sizing losing its meaning.
 */
const CENTER_SIZE_BOOST = 6;

/** The per-point buffers a drawing is seeded with, in point-index order. */
export interface SeedBuffers {
  readonly positions: Float32Array;
  readonly sizes: Float32Array;
  /** How many points came from {@link seedBuffers}'s `carried` map rather than the ring. */
  readonly carriedOver: number;
}

/**
 * Where each Entity sits right now, by id. The carry-over is keyed by id and not by index because
 * `graphPayload` orders points by degree: an Entity that survives a data swap generally moves index.
 */
export function positionsById(
  nodes: readonly LinkedEntity[],
  positions: ArrayLike<number>,
): Map<string, [number, number]> {
  const at = new Map<string, [number, number]>();
  for (let i = 0; i < nodes.length; i++) {
    const x = positions[i * 2];
    const y = positions[i * 2 + 1];
    // cosmos.gl reads a NaN position as an *absent* point; such a seed would strand the node.
    if (Number.isFinite(x) && Number.isFinite(y)) at.set(nodes[i].id, [x, y]);
  }
  return at;
}

/**
 * The point buffers for one payload: positions on a seed ring around the middle of the space — where the
 * centre sits, because that is where it is pinned (ADR-0072) — and sizes derived from degree.
 *
 * `carried` holds where the previous drawing's Entities currently are, so an Entity that survives a data
 * swap stays exactly where the reader last saw it and a depth flip or a decor reveal grows the picture
 * in place instead of re-scattering it. The centre is carried too: it is pinned, but a reader may drag
 * it, and a swap must not undo that.
 */
export function seedBuffers(
  payload: GraphPayload,
  centerIndex: number,
  carried?: ReadonlyMap<string, readonly [number, number]>,
): SeedBuffers {
  const { nodes, degrees } = payload;
  const positions = new Float32Array(nodes.length * 2);
  const sizes = new Float32Array(nodes.length);
  let carriedOver = 0;

  for (let i = 0; i < nodes.length; i++) {
    const held = carried?.get(nodes[i].id);
    if (held) carriedOver++;
    const angle = (i / nodes.length) * Math.PI * 2;
    positions[i * 2] = held ? held[0] : SPACE / 2 + (i === centerIndex ? 0 : Math.cos(angle) * SEED_RING);
    positions[i * 2 + 1] = held ? held[1] : SPACE / 2 + (i === centerIndex ? 0 : Math.sin(angle) * SEED_RING);
    // Square-rooted, so a hub reads as bigger without a degree-109 Entity swallowing the view. The base
    // is the click target: below ~8 units a leaf Entity is a speck that's hard to hit. The centre takes
    // a boost on top: at depth 1 every other node has the same degree-1 look.
    sizes[i] = 8 + Math.min(9, Math.sqrt(degrees[i]) * 2.2) + (i === centerIndex ? CENTER_SIZE_BOOST : 0);
  }

  return { positions, sizes, carriedOver };
}

/** The centre's *point index*, only knowable from the payload — `graphPayload` re-orders the nodes. */
export function centerPoint(payload: GraphPayload, center: string | null): number {
  return center === null ? -1 : payload.nodes.findIndex((node) => node.id === center);
}
