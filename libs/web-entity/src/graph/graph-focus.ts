import type { Graph } from '@cosmos.gl/graph';
import { WorldGraphNode } from '@hexly/domain';
import { GraphColors, linkColors, pointColors } from './graph-colors';

/**
 * How long the pointer must settle before the focus fade commits. A sweep across the canvas fires a
 * burst of over/out events — one per node brushed — and applying each would flash the whole graph.
 */
const HOVER_DEBOUNCE_MS = 50;

/**
 * How long the hover focus fades in and out. Longer than the chrome's `--dur-base`: a canvas-wide
 * crossfade needs more time than a button to read as motion at all.
 */
const HOVER_FADE_MS = 300;

/** What is left of a node or link outside the hovered neighbourhood — an alpha multiplier. */
const HOVER_DIM = 0.15;

/** The hover focus and the colour buffers it fades — one per mount, owning the graph's colours. */
export interface GraphFocus {
  /** Commit a hover once the pointer settles; `undefined` clears the focus. */
  hover(index: number | undefined): void;
  /**
   * Bake a resolved colour set into the base colours and apply it, keeping any committed focus — a
   * theme flip moves the hue without remounting, so the settled layout the reader is looking at
   * survives it.
   */
  useColors(next: GraphColors): void;
  /** The hovered Entity and its neighbours while a focus is applied — `null` when none is. */
  focused(): ReadonlySet<number> | null;
  /** Drop a pending commit, so a debounced hover can never fire against a destroyed graph. */
  destroy(): void;
}

export interface GraphFocusOptions {
  readonly cosmos: Graph;
  readonly nodes: readonly WorldGraphNode[];
  /** The payload's flat source/target pair array. */
  readonly links: Float32Array;
  /** The colours to open on — applied at once, so this is also the mount's colour seeding. */
  readonly colors: GraphColors;
  /** The focus moved: the label pass owes the neighbourhood its names, even if its loop has parked. */
  readonly onChange: () => void;
}

export function graphFocus({ cosmos, nodes, links, colors, onChange }: GraphFocusOptions): GraphFocus {
  const incident = incidentLinks(links, nodes.length);
  const everyPoint = Array.from({ length: nodes.length }, (_, i) => i);
  let applied: GraphColors;
  let basePointColors: Float32Array;
  let baseLinkColors: Float32Array;
  /** The committed hover target, so a theme flip can re-bake colours without losing the focus. */
  let focusIndex: number | undefined;
  let focusedSet: ReadonlySet<number> | null = null;
  let debounce = 0;

  // The focus treatment, in place of cosmos.gl's built-in greyout: that one is a status-texture flip,
  // which cannot animate. Recolouring the buffers instead lets `render`'s transition tween the fade —
  // in and out on the same clock, links and nodes together.
  const applyFocus = (index: number | undefined, fadeMs: number) => {
    if (index === undefined) {
      focusedSet = null;
      cosmos.setPointColors(basePointColors);
      cosmos.setLinkColors(baseLinkColors);
      cosmos.setConfigPartial({ focusedPointIndex: undefined, outlinedPointIndices: everyPoint });
    } else {
      const kept = new Set([index, ...cosmos.getNeighboringPointIndices(index)]);
      focusedSet = kept;
      const points = basePointColors.slice();
      for (let i = 0; i < nodes.length; i++) if (!kept.has(i)) points[i * 4 + 3] *= HOVER_DIM;
      const linkRgba = baseLinkColors.slice();
      for (let alpha = 3; alpha < linkRgba.length; alpha += 4) linkRgba[alpha] *= HOVER_DIM;
      for (const link of incident[index]) linkRgba.set(applied.linkHighlight, link * 4);
      cosmos.setPointColors(points);
      cosmos.setLinkColors(linkRgba);
      // The rings are one global colour, so a dimmed node's ring cannot fade with its body — it hands
      // the ring back instead, under cover of the body's own fade.
      cosmos.setConfigPartial({ focusedPointIndex: index, outlinedPointIndices: [...kept] });
    }
    cosmos.render(undefined, fadeMs);
    onChange();
  };

  const useColors = (next: GraphColors) => {
    applied = next;
    basePointColors = pointColors(nodes, next);
    baseLinkColors = linkColors(links.length / 2, next);
    // Every node wears a hairline ring, so a node the field's hue washes out keeps its shape.
    cosmos.setConfigPartial({ backgroundColor: next.background, outlinedPointRingColor: next.ring });
    applyFocus(focusIndex, 0);
  };
  useColors(colors);

  return {
    useColors,
    hover(index) {
      // Each over/out reschedules the same timer, so a burst of them while sweeping the canvas
      // collapses to a single apply on the target the pointer finally rests on.
      clearTimeout(debounce);
      debounce = window.setTimeout(() => {
        focusIndex = index;
        applyFocus(index, HOVER_FADE_MS);
      }, HOVER_DEBOUNCE_MS);
    },
    focused: () => focusedSet,
    destroy: () => clearTimeout(debounce),
  };
}

/**
 * Link indices by point: `GraphPayload.links` is a flat pair array, so finding the hovered Entity's
 * own edges needs this adjacency built once per mount.
 */
function incidentLinks(links: Float32Array, pointCount: number): number[][] {
  const incident: number[][] = Array.from({ length: pointCount }, () => []);
  for (let link = 0; link < links.length / 2; link++) {
    incident[links[link * 2]].push(link);
    incident[links[link * 2 + 1]].push(link);
  }
  return incident;
}
