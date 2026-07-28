import { LinkedEntity } from '@hexly/domain';
import { designTokenStyle, readDesignToken } from '@hexly/web-styles';
import { GENERIC_TYPE_DEFINITION, TypeDefinition } from '../models/type-definition';
import { typeColorToken } from '../models/type-tone';

/** The border ring's share of the ink colour's alpha — a hairline, not a second halo. */
const NODE_RING_ALPHA = 0.5;

/**
 * The graph's colours, resolved from the live theme's tokens — cosmos.gl wants 0..1 RGBA floats.
 * Not a "palette": that is the World Theme's word now (CONTEXT.md), and this is a colour per Entity
 * Type plus the field the nodes sit on.
 */
export interface GraphColors {
  /**
   * What the graph is drawn on — RGBA, not the token's own string: cosmos.gl parses a colour string
   * itself and answers black to the `oklch()` a derived token resolves to (ADR-0075).
   */
  readonly background: [number, number, number, number];
  /** RGBA node colour per Entity type, keyed by type id — the type's tone or its declared token, resolved (ADR-0048). */
  readonly byType: ReadonlyMap<string, [number, number, number, number]>;
  /** Fallback node colour for an unregistered type — the generic type's hue, as every other chrome resolves it. */
  readonly node: [number, number, number, number];
  readonly link: [number, number, number, number];
  /** The hovered Entity's own edges — pulled forward in the accent while the rest of the graph dims. */
  readonly linkHighlight: [number, number, number, number];
  /** The border ring every node wears, so a pale node holds its shape against the field. */
  readonly ring: [number, number, number, number];
}

export function graphColors(defs: readonly TypeDefinition[]): GraphColors {
  const style = designTokenStyle();
  const byType = new Map<string, [number, number, number, number]>();
  for (const def of defs) {
    byType.set(def.id, toRgba(readDesignToken(style, typeColorToken(def))));
  }
  const ink = toRgba(readDesignToken(style, '--color-ink'));
  return {
    background: toRgba(readDesignToken(style, '--color-surface-sunken')),
    byType,
    // An unregistered, absent, or disabled type paints with the generic definition's hue — the same
    // fallback `TypeRegistry.resolve` gives every other surface, so the graph needs no plugin of its own.
    node: toRgba(readDesignToken(style, typeColorToken(GENERIC_TYPE_DEFINITION))),
    link: toRgba(readDesignToken(style, '--color-line-strong')),
    linkHighlight: toRgba(readDesignToken(style, '--color-accent')),
    ring: [ink[0], ink[1], ink[2], ink[3] * NODE_RING_ALPHA],
  };
}

/** One RGBA quad per point, by point index; a node's colour is its type's registered hue. */
export function pointColors(nodes: readonly LinkedEntity[], colors: GraphColors): Float32Array {
  const buffer = new Float32Array(nodes.length * 4);
  for (let i = 0; i < nodes.length; i++) {
    // Colour by the node's primary type (`types[0]`); an unregistered or absent one takes the fallback.
    buffer.set(colors.byType.get(nodes[i].types[0]) ?? colors.node, i * 4);
  }
  return buffer;
}

/** One RGBA quad per link, by link index. */
export function linkColors(count: number, colors: GraphColors): Float32Array {
  const buffer = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) buffer.set(colors.link, i * 4);
  return buffer;
}

/**
 * Any CSS colour — hex, `rgb()`, `oklch()` — as cosmos.gl's 0..1 RGBA floats. A 1×1 canvas is the
 * browser's own parser, which is the only parser guaranteed to accept whatever notation a derived
 * token resolves to (ADR-0075); every colour a renderer is handed goes through here first.
 *
 * Not `rasteriseColors` from `@hexly/web-styles`, which answers 8-bit RGB: alpha is a value here —
 * the ring rides the ink's, and the hover fade scales it.
 */
function toRgba(css: string): [number, number, number, number] {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [0, 0, 0, 1];
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return [r / 255, g / 255, b / 255, a / 255];
}
