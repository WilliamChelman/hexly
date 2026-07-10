import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import type { Graph } from '@cosmos.gl/graph';
import { LinkedEntity, WorldGraph } from '@hexly/domain';
import { Logger, ThemeService, isTrackpadWheel, wheelDeltaPixels } from '@hexly/web-core';
import { GraphPayload, graphPayload } from './graph-payload';
import { LabelGrid, selectLabels } from './label-selection';

/**
 * The declutter: at most one Entity label per {@link LABEL_GRID.pointCell} of screen, and one Link
 * Descriptor per `linkCell`. `max` is a ceiling on the DOM one frame may touch, not the mechanism.
 */
const LABEL_GRID: LabelGrid = { pointCell: 90, linkCell: 120, max: 400 };

/** cosmos.gl's fixed simulation space. Anything larger crashes iOS; it caps at 4096. */
const SPACE = 4096;

/**
 * A link spring of 1 (the default) drags clusters into an unreadable knot. This is the one layout
 * knob that matters — raising `simulationRepulsion` does nothing visible, and lowering
 * `simulationGravity` backfires by letting orphan Entities drift off screen.
 */
const LINK_SPRING = 0.3;

/**
 * "Readable" is an alpha threshold, crossed long before the simulation truly ends (`onSimulationEnd`
 * fires at alpha < 1e-3, ~{@link SIMULATION_DECAY} frames further on). The re-fit fires here so the
 * graph is framed the moment it's legible, not tens of seconds later once the layout has frozen.
 */
const SETTLED_ALPHA = 0.05;

/**
 * **Smaller cools faster** — cosmos.gl's own config doc states the opposite, and it is wrong
 * (measured: 20 000 left alpha at 0.37 after 16 s, where the default 5 000 reaches 0.16 by 8 s).
 * At the default the layout takes ~18 s to cross {@link SETTLED_ALPHA}, so a reader watches the
 * graph crawl. This lands it in about two seconds.
 */
const SIMULATION_DECAY = 1500;

/**
 * Wait for the layout to contract before framing it. cosmos.gl's default 250 ms fits the seed
 * *ring*, and the simulation then pulls the graph into a fraction of that box — leaving a speck in
 * the middle of an empty canvas until the reader zooms. Fitting late is what makes the first
 * paint usable, so this tracks the settle above rather than the library's default.
 */
const FIT_VIEW_DELAY_MS = 1200;

/** How long the settle re-fit takes to glide the graph into frame. */
const FIT_MS = 250;

/**
 * After the last pan wheel event, how long to keep the label loop awake so it tracks the final
 * frame in. A trackpad swipe fires a burst of `wheel` events with no "end" signal, so the loop is
 * held live for a beat past the last one, then parks itself as any settled graph does.
 */
const PAN_IDLE_MS = 120;

/**
 * Reheat energy held on the simulation *throughout* a drag, so the moved Entity's neighbours follow
 * in real time rather than snapping into place on release. Re-applied each `onDrag` frame — like
 * d3's `alphaTarget` — then left to cool once the reader lets go.
 */
const REHEAT_ALPHA = 0.3;

/**
 * A dark outline stamped around the white Entity labels — four diagonal offsets for the body of the
 * contour, one soft drop for depth — so a name stays legible over a pale node, a dark one, or the
 * links crossing behind it, in either theme. Cheaper and crisper at 9px than `-webkit-text-stroke`,
 * which thins the glyphs.
 */
const LABEL_CONTOUR =
  '-1px -1px 0 #111, 1px -1px 0 #111, -1px 1px 0 #111, 1px 1px 0 #111, 0 1px 2px rgba(0,0,0,0.6)';

/**
 * How long the pointer must settle before the focus grey-out commits. A sweep across the canvas
 * fires a burst of over/out events — one per node brushed — and applying each would flash the whole
 * graph light and dark. Debouncing coalesces the burst into a single commit on the node the pointer
 * finally rests on, so focus only ever reflects where a reader actually paused.
 */
const HOVER_DEBOUNCE_MS = 50;

/** Read a design token, so the canvas follows the theme (ADR-0007's palette, not hardcoded hex). */
function token(
  style: CSSStyleDeclaration,
  name: string,
  fallback: string,
): string {
  return style.getPropertyValue(name).trim() || fallback;
}

/**
 * The theme's colours, as cosmos.gl holds them: baked into GPU buffers, never read back from CSS.
 * That is why {@link GraphCanvas.repaint} exists at all — and why the whole palette is resolved in
 * one computed-style read rather than one per token.
 */
interface Palette {
  readonly background: string;
  readonly note: [number, number, number, number];
  readonly hexmap: [number, number, number, number];
  readonly link: [number, number, number, number];
}

function palette(): Palette {
  const style = getComputedStyle(document.documentElement);
  return {
    background: token(style, '--color-surface-sunken', '#ece0c0'),
    note: toRgba(token(style, '--color-ink-muted', '#6f5a36')),
    hexmap: toRgba(token(style, '--color-gold', '#9a6a16')),
    link: toRgba(token(style, '--color-line-strong', '#b89a62')),
  };
}

/** One RGBA quad per point, by point index. */
function pointColors(
  nodes: readonly LinkedEntity[],
  palette: Palette,
): Float32Array {
  const colors = new Float32Array(nodes.length * 4);
  for (let i = 0; i < nodes.length; i++) {
    colors.set(
      nodes[i].type === 'hexmap' ? palette.hexmap : palette.note,
      i * 4,
    );
  }
  return colors;
}

/** One RGBA quad per link, by link index. */
function linkColors(count: number, palette: Palette): Float32Array {
  const colors = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) colors.set(palette.link, i * 4);
  return colors;
}

/**
 * Any CSS colour — hex, `rgb()`, `rgba()` — as cosmos.gl's 0..1 RGBA floats. A 1×1 canvas is the
 * browser's own parser, so a token that resolves to `rgba()` works as well as one that resolves to
 * a hex triple; parsing `#rrggbb` by hand would silently drop the alpha ones.
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

/** A live cosmos.gl graph and the arrays the label pass reads it through. */
interface Mounted {
  readonly cosmos: Graph;
  readonly payload: GraphPayload;
  /** The buffer the graph was seeded with, re-read from the GPU every frame by the label pass. */
  readonly positions: Float32Array;
}

/**
 * The World Graph's renderer: a GPU force simulation (cosmos.gl) under a DOM label overlay.
 *
 * cosmos.gl renders **no text at all**, so every label here is DOM we own. It does supply the hard
 * part: `getSampledPointPositionsMap` / `getSampledLinkPositionsMap` return only what is on screen,
 * thinned to one element per sampling cell — declutter and viewport cull in one call, without
 * touching the other nodes. Reading *all* positions each frame instead costs twice as much.
 *
 * The library is dynamically imported: it is ~168 kB gzip of WebGL that renders nothing
 * server-side, and nothing outside this page needs it.
 */
/** A reader's click on a node: the Entity to open, and whether a modifier asked for a new tab. */
export interface GraphOpen {
  readonly id: string;
  /** Ctrl/Cmd (or a middle-click) was held — open the Entity in a new tab, as a link would. */
  readonly newTab: boolean;
}

@Component({
  selector: 'app-graph-canvas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block w-full h-full' },
  template: `
    <div #host class="relative w-full h-full" data-testid="graph-canvas">
      <!-- The text layer cosmos.gl doesn't have. Pointer-transparent: the canvas below owns hover. -->
      <div
        #overlay
        class="absolute inset-0 pointer-events-none overflow-hidden select-none"
        aria-hidden="true"
      ></div>
    </div>
  `,
})
export class GraphCanvas {
  readonly graph = input.required<WorldGraph>();
  /** The Entity a reader clicked, for the page to navigate to. */
  readonly open = output<GraphOpen>();

  private readonly hostEl =
    viewChild.required<ElementRef<HTMLDivElement>>('host');
  private readonly overlayEl =
    viewChild.required<ElementRef<HTMLDivElement>>('overlay');
  private readonly theme = inject(ThemeService);
  private readonly logger = inject(Logger);

  private mounted: Mounted | null = null;
  /** The label loop's rAF id; `0` means it has parked itself, waiting on {@link wake} to restart. */
  private frame = 0;
  /** Reused label spans — the loop repaints in place rather than churning the DOM every frame. */
  private labels: HTMLSpanElement[] = [];
  /** A drag or pan/zoom is in flight: keep repainting even after the force simulation has cooled. */
  private interacting = false;
  /**
   * The reader has taken the viewport — a user pan, zoom, or node drag. Once set, the settle re-fit
   * is suppressed, so the camera never jumps out from under a reader already moving the controls.
   */
  private viewPinned = false;
  /** Tears down the two-finger pan wheel listener; aborted by {@link teardown} with the mount. */
  private panControls: AbortController | null = null;
  /** Pending {@link HOVER_DEBOUNCE_MS} focus commit; cleared on teardown so it never fires post-destroy. */
  private hoverTimer = 0;
  /** Restart the parked label loop. Set by {@link paintLabels}; a no-op until the loop is mounted. */
  private wake: () => void = () => {
    /* no loop to wake before mount */
  };

  constructor() {
    effect((onCleanup) => {
      const graph = this.graph();
      const host = this.hostEl().nativeElement;
      const overlay = this.overlayEl().nativeElement;

      let stale = false;
      this.teardown();
      this.mount(graph, host).then(
        (mounted) => {
          // The label loop starts here, past the stale check, and never inside `mount`. A mount
          // that resolves stale is destroyed on the spot; a loop started before this branch would
          // outlive it, projecting labels off a destroyed WebGL graph every frame, forever.
          if (stale) return void mounted?.cosmos.destroy();
          this.mounted = mounted;
          if (mounted) {
            this.paintLabels(mounted, host, overlay);
            this.panControls = this.enableTwoFingerPan(mounted.cosmos, host);
          }
        },
        (err) => this.logger.error('Failed to render the World Graph', err),
      );

      onCleanup(() => (stale = true));
    });

    // A theme flip re-bakes the colours and nothing else. Remounting would restart the force
    // simulation and throw away the settled layout the reader is looking at, to change a hue.
    effect(() => {
      this.theme.theme();
      this.repaint();
    });

    inject(DestroyRef).onDestroy(() => this.teardown());
  }

  /**
   * Re-bake the theme's colours into cosmos.gl's buffers. `render()` with no alpha leaves the
   * simulation exactly where it stands, so the layout survives the flip and only the colour moves.
   */
  private repaint(): void {
    if (!this.mounted) return;
    const { cosmos, payload } = this.mounted;
    const colors = palette();
    cosmos.setPointColors(pointColors(payload.nodes, colors));
    cosmos.setLinkColors(linkColors(payload.links.length / 2, colors));
    cosmos.setConfigPartial({ backgroundColor: colors.background });
    cosmos.render();
  }

  private async mount(
    graph: WorldGraph,
    host: HTMLDivElement,
  ): Promise<Mounted | null> {
    const { Graph } = await import('@cosmos.gl/graph');
    if (graph.nodes.length === 0) return null;

    const payload = graphPayload(graph);
    const { nodes, degrees, links } = payload;
    /** The settle re-fit happens once, on the first tick that cools past the threshold. */
    let fitted = false;
    const colors = palette();

    const positions = new Float32Array(nodes.length * 2);
    const sizes = new Float32Array(nodes.length);
    for (let i = 0; i < nodes.length; i++) {
      // Seed on a ring rather than a point, so the simulation has somewhere to push from.
      const angle = (i / nodes.length) * Math.PI * 2;
      positions[i * 2] = SPACE / 2 + Math.cos(angle) * 500;
      positions[i * 2 + 1] = SPACE / 2 + Math.sin(angle) * 500;
      // Square-rooted, so a hub reads as bigger without a degree-109 Entity swallowing the view.
      // The base is the click target: below ~8 units a leaf Entity is a speck that's hard to hit.
      sizes[i] = 8 + Math.min(9, Math.sqrt(degrees[i]) * 2.2);
    }

    // Commit the focus grey-out only once the pointer settles: each over/out reschedules the same
    // timer, so a burst of them while sweeping the canvas collapses to a single apply on the target
    // the pointer finally rests on (or a clear, when that target is the background).
    const focus = (index: number | undefined) => {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = window.setTimeout(() => {
        cosmos.setConfigPartial(
          index === undefined
            ? {
                highlightedPointIndices: undefined,
                focusedPointIndex: undefined,
              }
            : {
                highlightedPointIndices: [
                  index,
                  ...cosmos.getNeighboringPointIndices(index),
                ],
                focusedPointIndex: index,
              },
        );
      }, HOVER_DEBOUNCE_MS);
    };

    const cosmos = new Graph(host, {
      backgroundColor: colors.background,
      enableDrag: true,
      fitViewOnInit: true,
      fitViewDelay: FIT_VIEW_DELAY_MS,
      simulationDecay: SIMULATION_DECAY,
      // A World's layout should be the same picture every time it is opened.
      randomSeed: 42,
      spaceSize: SPACE,
      simulationLinkSpring: LINK_SPRING,
      simulationGravity: 0.15,
      simulationRepulsion: 0.6,
      // No `*SamplingDistance` here: cosmos.gl's sampled maps are unused. Their grid is anchored to
      // the *screen*, so a pan slides nodes across cell boundaries and re-elects every cell — the
      // labels flicker. `selectLabels` elects on a grid anchored in graph space instead.
      onPointClick: (index, _position, event) =>
        this.open.emit({
          id: nodes[index].id,
          newTab: event.ctrlKey || event.metaKey || event.button === 1,
        }),
      // Focus mode, built in: everything outside the hovered Entity's neighbourhood greys out.
      // Debounced (see {@link focus}) so a sweep across the canvas doesn't strobe the grey-out.
      onPointMouseOver: (index) => focus(index),
      onPointMouseOut: () => focus(undefined),
      // A pan/zoom shifts the projection and a drag moves the point; both need the label loop awake
      // even when the force simulation is cold. The gesture holds `interacting`; `wake` restarts the
      // loop if it had parked. Dragging also reheats the simulation, which re-drives the loop itself.
      onZoomStart: (_event, userDriven) => {
        // Only a real gesture pins the view; cosmos's own fit animations report `userDriven: false`.
        if (userDriven) this.viewPinned = true;
        this.startInteracting();
      },
      onZoomEnd: () => (this.interacting = false),
      onDragStart: () => {
        this.viewPinned = true;
        this.startInteracting();
      },
      // Hold the simulation warm for the whole drag, so neighbours ease along with the moved point
      // instead of jumping when it's released. Cooling resumes on its own once the drag ends.
      onDrag: () => cosmos.start(REHEAT_ALPHA),
      onDragEnd: () => (this.interacting = false),
      onSimulationTick: (alpha) => {
        // This marks the layout as *readable*, not as finished: the simulation runs on until alpha
        // crosses 1e-3 (`onSimulationEnd`), so the re-fit fires here, at a legible threshold, rather
        // than tens of seconds later. The label loop tracks the points until that real end.
        if (alpha > SETTLED_ALPHA || fitted) return;
        fitted = true;
        // `fitViewOnInit` frames the *seed* ring, and the simulation then contracts the graph to a
        // fraction of it — leaving a speck in the middle of an empty canvas. Re-fit once, on settle —
        // but never once the reader has grabbed the viewport, or the camera jumps out from under them.
        if (!this.viewPinned) cosmos.fitView(FIT_MS);
        host.dataset['settled'] = 'true'; // A hook for tests waiting on the layout.
      },
    });

    cosmos.setPointPositions(positions);
    cosmos.setPointColors(pointColors(nodes, colors));
    cosmos.setPointSizes(sizes);
    cosmos.setLinks(links);
    cosmos.setLinkColors(linkColors(links.length / 2, colors));
    cosmos.render();

    return { cosmos, payload, positions };
  }

  /**
   * The label pass. `selectLabels` decides *which* Entities and Link Descriptors are labelled — on a
   * grid anchored in graph space, so panning never changes the set — and this only projects the
   * winners to the screen and writes the DOM.
   *
   * Render-on-demand: the loop repaints only while something still moves the labels — the force
   * simulation is running (`cosmos.isSimulationRunning`), or a drag/pan is in flight
   * ({@link interacting}). When both go quiet it parks itself ({@link frame} = 0), so a settled graph
   * costs nothing per frame. {@link wake} restarts it when the reader next interacts, and a drag
   * reheats the simulation — which brings `isSimulationRunning` back true and re-drives the loop.
   *
   * Only ever called on a live mount, past the effect's stale check — the loop it starts owns
   * {@link frame} until {@link teardown} cancels it.
   */
  private paintLabels(
    { cosmos, payload, positions }: Mounted,
    host: HTMLDivElement,
    overlay: HTMLDivElement,
  ): void {
    const { nodes, links, descriptors } = payload;

    /** The camera, in the space units `selectLabels` elects on. */
    const currentView = () => {
      // Screen pixels per space unit, read off the transform rather than `getZoomLevel`, which is
      // relative to the initial fit and so does not answer "how big is a space unit right now".
      const [originX] = cosmos.spaceToScreenPosition([0, 0]);
      const [unitX] = cosmos.spaceToScreenPosition([1, 0]);
      const [ax, ay] = cosmos.screenToSpacePosition([0, 0]);
      const [bx, by] = cosmos.screenToSpacePosition([
        host.clientWidth,
        host.clientHeight,
      ]);
      return {
        scale: unitX - originX,
        minX: Math.min(ax, bx),
        maxX: Math.max(ax, bx),
        minY: Math.min(ay, by),
        maxY: Math.max(ay, by),
      };
    };

    const tick = () => {
      let used = 0;

      const place = (
        text: string,
        x: number,
        y: number,
        angle: number | null,
      ) => {
        if (!text || used >= LABEL_GRID.max) return;
        let label = this.labels[used];
        if (!label) {
          label = document.createElement('span');
          label.style.position = 'absolute';
          label.style.whiteSpace = 'nowrap';
          label.style.willChange = 'transform';
          overlay.appendChild(label);
          this.labels[used] = label;
        }
        label.style.display = '';
        label.style.left = `${x}px`;
        label.style.top = `${y}px`;
        label.style.transform =
          angle === null
            ? 'translate(-50%, 0)'
            : `translate(-50%, -100%) rotate(${angle}rad)`;
        // Entity names are white-on-contour for readability over any node or the links behind them;
        // Link Descriptors stay in the muted line colour, riding along the edge they annotate. Spans
        // are reused across both roles, so each branch sets the shadow the other would otherwise leave.
        if (angle === null) {
          label.style.color = '#fff';
          label.style.textShadow = LABEL_CONTOUR;
          label.style.font = '9px sans-serif';
        } else {
          label.style.color = 'var(--color-line-strong)';
          label.style.textShadow = 'none';
          label.style.font = '8px sans-serif';
        }
        if (label.textContent !== text) label.textContent = text;
        used++;
      };

      // Re-read the GPU's positions while anything still moves them — the simulation's forces, or a
      // reader dragging a point. `isSimulationRunning` goes false mid-drag, which is why the loop
      // also stays awake on `interacting`; skipping this read would strand labels where a node used
      // to be. Once both are quiet the loop parks below and stops reading entirely.
      positions.set(cosmos.getPointPositions());

      const selection = selectLabels(
        payload,
        positions,
        currentView(),
        LABEL_GRID,
      );

      for (const index of selection.points) {
        const [x, y] = cosmos.spaceToScreenPosition([
          positions[index * 2],
          positions[index * 2 + 1],
        ]);
        place(nodes[index].name, x, y + 6, null);
      }
      for (const index of selection.links) {
        const source = links[index * 2];
        const target = links[index * 2 + 1];
        const [sx, sy] = cosmos.spaceToScreenPosition([
          positions[source * 2],
          positions[source * 2 + 1],
        ]);
        const [tx, ty] = cosmos.spaceToScreenPosition([
          positions[target * 2],
          positions[target * 2 + 1],
        ]);
        // Angle in screen space, so the label lies along the edge as drawn, at any zoom.
        place(
          descriptors[index],
          (sx + tx) / 2,
          (sy + ty) / 2,
          upright(Math.atan2(ty - sy, tx - sx)),
        );
      }

      for (let i = used; i < this.labels.length; i++)
        this.labels[i].style.display = 'none';

      // Keep going only while there is motion to track; otherwise park and wait for `wake`.
      this.frame =
        cosmos.isSimulationRunning || this.interacting
          ? requestAnimationFrame(tick)
          : 0;
    };

    // Restart the parked loop from an interaction handler, keeping at most one frame in flight.
    this.wake = () => {
      if (this.frame === 0) this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  /** An interaction began: keep the label loop awake, restarting it if it had parked. */
  private startInteracting(): void {
    this.interacting = true;
    this.wake();
  }

  /**
   * Two-finger trackpad pan. cosmos.gl's zoom is d3-zoom on the canvas, which reads *every* wheel
   * event as a zoom — so a two-finger swipe zooms instead of panning, and there is no built-in pan
   * to swap in. The pan gestures are intercepted in the capture phase, before d3-zoom on the canvas
   * below can see them, and turned into a pan. What falls through to the built-in zoom: a zoom
   * modifier (pinch or Ctrl/Cmd+wheel), and a *vertical* mouse-wheel notch — so a mouse still zooms
   * the graph as it always has.
   *
   * A horizontal-dominant wheel is *always* taken as a pan, even when it looks like a mouse notch.
   * `preventDefault` on it is what stops the browser reading a leftward two-finger swipe as history
   * back-navigation — and `isTrackpadWheel` keys off `deltaY` alone, so a mostly-sideways swipe can
   * momentarily read as a mouse and leak the event to the browser. The axis check closes that hole.
   *
   * There is no `panBy`, so the pan goes through the one public lever that moves the camera without
   * animation: refit the current viewport box, shifted by the swipe, with zero duration and zero
   * padding — same zoom, new centre.
   */
  private enableTwoFingerPan(
    cosmos: Graph,
    host: HTMLDivElement,
  ): AbortController {
    const controls = new AbortController();
    let idle = 0;

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return; // Pinch or Ctrl/Cmd+wheel — cosmos's built-in zoom.
      // Horizontal-dominant wheels always pan (and so are always caught, keeping the browser from
      // swiping back); a vertical mouse-wheel notch is left to cosmos to zoom, only a trackpad pans.
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      if (!horizontal && !isTrackpadWheel(event)) return;
      event.preventDefault();
      event.stopPropagation(); // Capture phase: keep it from reaching d3-zoom on the canvas below.

      // Screen pixels per space unit, off the transform — the same reading the label pass elects on.
      const [originX] = cosmos.spaceToScreenPosition([0, 0]);
      const [unitX] = cosmos.spaceToScreenPosition([1, 0]);
      const scale = unitX - originX;
      if (!scale) return;

      const dx =
        wheelDeltaPixels(event.deltaX, event, host.clientWidth) / scale;
      // Space y runs opposite screen y here, so the vertical swipe is negated while the horizontal
      // one is not — scrolling down still walks the view down the World, as a scrollbar would.
      const dy =
        -wheelDeltaPixels(event.deltaY, event, host.clientHeight) / scale;
      const [ax, ay] = cosmos.screenToSpacePosition([0, 0]);
      const [bx, by] = cosmos.screenToSpacePosition([
        host.clientWidth,
        host.clientHeight,
      ]);
      // Shift both corners by the swipe and refit: the box keeps its size (zoom holds) and only its
      // centre moves.
      const box = new Float32Array([ax + dx, ay + dy, bx + dx, by + dy]);
      cosmos.setZoomTransformByPointPositions(box, 0, undefined, 0, false);

      this.viewPinned = true;
      this.startInteracting();
      clearTimeout(idle);
      idle = window.setTimeout(() => (this.interacting = false), PAN_IDLE_MS);
    };

    host.addEventListener('wheel', onWheel, {
      passive: false,
      capture: true,
      signal: controls.signal,
    });
    controls.signal.addEventListener('abort', () => clearTimeout(idle));
    return controls;
  }

  private teardown(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.wake = () => {
      /* stale handlers must not touch the torn-down loop */
    };
    this.interacting = false;
    this.viewPinned = false;
    this.panControls?.abort();
    this.panControls = null;
    clearTimeout(this.hoverTimer);
    this.hoverTimer = 0;
    this.labels = [];
    const overlay = this.overlayEl?.()?.nativeElement;
    if (overlay) overlay.textContent = '';
    this.mounted?.cosmos.destroy();
    this.mounted = null;
  }
}

/** Flip an edge label that would otherwise read upside-down. */
function upright(angle: number): number {
  if (angle > Math.PI / 2) return angle - Math.PI;
  if (angle < -Math.PI / 2) return angle + Math.PI;
  return angle;
}
