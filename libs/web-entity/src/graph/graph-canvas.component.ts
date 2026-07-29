import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  output,
  untracked,
  viewChild,
} from '@angular/core';
import type { Graph, GraphConfig } from '@cosmos.gl/graph';
import { WorldGraph } from '@hexly/domain';
import { ColorSchemeService, Logger, isTrackpadWheel, wheelDeltaPixels } from '@hexly/web-core';
import { nodeLabel } from './foreign-node';
import { FramingCamera, currentView, framingCamera, spaceScale } from './graph-camera';
import { GraphFocus, graphFocus } from './graph-focus';
import { GraphWarmPool, WarmGraph } from './graph-warm-pool';
import { GraphPayload, graphPayload } from './graph-payload';
import { graphColors } from './graph-colors';
import { SPACE, centerPoint, positionsById, seedBuffers } from './graph-seed';
import { LabelGrid, selectLabels } from './select-labels';
import { ENTITY_TYPES } from '../models/entity-types';

/**
 * The declutter: at most one Entity label per {@link LABEL_GRID.pointCell} of screen, and one Link
 * Descriptor per `linkCell`. `max` caps each election — at most that many Entity names in the
 * viewport, highest-degree first — and twice it is the ceiling on the DOM one frame may touch.
 * `sparse` is the declutter's off-switch: at that few Entities in view (a Local Graph at depth 1,
 * a deep zoom) every name has room, so every visible node is labelled.
 */
const LABEL_GRID: LabelGrid = { pointCell: 90, linkCell: 120, max: 200, sparse: 30 };

/**
 * The crowd reading the label layer's opacity follows: at this many Entities in view (or fewer)
 * the labels are fully opaque; past it they recede on a square-root curve — zooming in thins the
 * crowd, so the labels surface gradually instead of popping at a threshold.
 */
const LABEL_CROWD = 80;

/** The recession's floor: a dense overview keeps faint labels rather than losing them outright. */
const LABEL_MIN_OPACITY = 0.25;

/**
 * A link spring of 1 (the default) drags clusters into an unreadable knot. Raising
 * `simulationRepulsion` does nothing visible, and lowering `simulationGravity` lets orphan Entities
 * drift off screen.
 */
const LINK_SPRING = 0.3;

/**
 * The alpha at which the layout reads as settled — crossed long before the simulation truly ends
 * (`onSimulationEnd` fires at alpha < 1e-3, ~{@link SIMULATION_DECAY} frames further on).
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
 * How long the label loop stays awake past the last pan wheel event. A trackpad swipe fires a burst
 * of `wheel` events with no "end" signal, so the loop is held live for a beat past the last one.
 */
const PAN_IDLE_MS = 120;

/**
 * Reheat energy held on the simulation *throughout* a drag — re-applied each `onDrag` frame, like
 * d3's `alphaTarget` — so the moved Entity's neighbours follow in real time rather than snapping
 * into place on release.
 */
const REHEAT_ALPHA = 0.3;

/**
 * A dark outline stamped around the white Entity labels — four diagonal offsets for the body of the
 * contour, one soft drop for depth — so a name stays legible over a pale node, a dark one, or the
 * links crossing behind it, in either ColorScheme. Cheaper and crisper at 9px than `-webkit-text-stroke`,
 * which thins the glyphs.
 */
const LABEL_CONTOUR = '-1px -1px 0 #111, 1px -1px 0 #111, -1px 1px 0 #111, 1px 1px 0 #111, 0 1px 2px rgba(0,0,0,0.6)';

/**
 * The data on screen. Its fields are replaced *in place* by {@link GraphCanvasComponent.swap}, so the
 * cosmos.gl handlers — bound once, at mount — always act on the payload currently drawn.
 */
interface Drawing {
  payload: GraphPayload;
  /** The buffer the graph was seeded with, re-read from the GPU every frame by the label pass. */
  positions: Float32Array;
  focus: GraphFocus;
  /** Whether *this* payload's layout has cooled past {@link SETTLED_ALPHA}. */
  settled: boolean;
}

/** A live cosmos.gl graph and the per-mount pieces the loops read it through. */
interface Mounted {
  readonly cosmos: Graph;
  /** The element the canvas was mounted into — a different one is a different mount, not a swap. */
  readonly host: HTMLDivElement;
  /** The pool entry this mount adopted, if any — the pool owns its teardown. */
  readonly adopted: WarmGraph | null;
  readonly camera: FramingCamera;
  readonly drawing: Drawing;
}

/** A reader's click on a node: the Entity to open, and whether a modifier asked for a new tab. */
export interface GraphOpen {
  readonly id: string;
  /** Ctrl/Cmd (or a middle-click) was held — open the Entity in a new tab, as a link would. */
  readonly newTab: boolean;
}

/**
 * The graph renderer both graph surfaces draw through — the World Graph page and the Local Graph Panel
 * (ADR-0072): a GPU force simulation (cosmos.gl) under a DOM label overlay. cosmos.gl renders **no text
 * at all**, so every label here is DOM we own. The library is dynamically imported — ~168 kB gzip of
 * WebGL that renders nothing server-side.
 *
 * It reads the registered types through {@link ENTITY_TYPES}, not `apps/web`'s registry, so a graph can
 * be drawn from this lib (the Panel) as well as from the page.
 */
@Component({
  selector: 'app-graph-canvas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block w-full h-full' },
  template: `
    <div #host class="relative w-full h-full" data-testid="graph-canvas">
      <!-- The text layer cosmos.gl doesn't have. Pointer-transparent: the canvas below owns hover. -->
      <div #overlay class="absolute inset-0 pointer-events-none overflow-hidden select-none" aria-hidden="true"></div>
    </div>
  `,
})
export class GraphCanvasComponent {
  readonly graph = input.required<WorldGraph>();
  /**
   * The Entity the drawing is *about*, drawn larger than its degree alone would earn it — the Local
   * Graph's centre (ADR-0072). `null` for a whole-World graph, which is about no one Entity.
   */
  readonly center = input<string | null>(null);
  /** The Entity a reader clicked, for the page to navigate to. */
  readonly open = output<GraphOpen>();

  private readonly hostEl = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private readonly overlayEl = viewChild.required<ElementRef<HTMLDivElement>>('overlay');
  private readonly colorScheme = inject(ColorSchemeService);
  private readonly logger = inject(Logger);
  private readonly types = inject(ENTITY_TYPES);
  private readonly pool = inject(GraphWarmPool);

  private mounted: Mounted | null = null;
  /**
   * Identifies the mount currently in flight (the dynamic import, then the graph's own bring-up).
   * {@link teardown} clears it, so a mount that lands afterwards is destroyed rather than drawn.
   */
  private mounting: object | null = null;
  /** Data that arrived while a mount was in flight — drawn as that mount's first swap. */
  private pending: { graph: WorldGraph; center: string | null } | null = null;
  /** The label loop's rAF id; `0` means it has parked itself, waiting on {@link wake} to restart. */
  private frame = 0;
  /** Reused label spans — the loop repaints in place rather than churning the DOM every frame. */
  private labels: HTMLSpanElement[] = [];
  /** A drag or pan/zoom is in flight: keep repainting even after the force simulation has cooled. */
  private interacting = false;
  /** Tears down the two-finger pan wheel listener; aborted by {@link teardown} with the mount. */
  private panControls: AbortController | null = null;
  /** Restart the parked label loop. Set by {@link paintLabels}; a no-op until the loop is mounted. */
  private wake: () => void = () => {
    /* no loop to wake before mount */
  };

  constructor() {
    effect(() => {
      const graph = this.graph();
      const center = this.center();
      const host = this.hostEl().nativeElement;
      const overlay = this.overlayEl().nativeElement;

      // Nothing to draw: the mount goes, rather than being swapped to an empty drawing.
      if (graph.nodes.length === 0) return void this.teardown();

      // New data re-seeds the *live* graph. Rebuilding it instead would recreate a WebGL context and
      // recompile cosmos.gl's shaders on the main thread — which is what every depth flip and decor
      // reveal in the Local Graph Panel used to cost (ADR-0072).
      // `untracked`: the swap bakes the colours, and the type registry it reads is a signal — a plugin
      // registering a type must not read as new graph data.
      const live = this.mounted;
      if (live && live.host === host) return void untracked(() => this.swap(live, graph, center));

      // A mount already in flight draws this data itself, as its first swap, the moment it lands.
      if (this.mounting) {
        this.pending = { graph, center };
        return;
      }

      this.teardown();
      const token = (this.mounting = {});
      this.mount(graph, center, host).then(
        (mounted) => {
          // The label loop starts here, past the stale check, and never inside `mount`. A mount that
          // lands after a teardown is destroyed on the spot; a loop started before this branch would
          // outlive it, projecting labels off a destroyed WebGL graph every frame, forever.
          if (this.mounting !== token) return void this.destroyMount(mounted);
          this.mounting = null;
          this.mounted = mounted;
          this.paintLabels(mounted, overlay);
          this.panControls = this.enableTwoFingerPan(mounted);
          const pending = this.pending;
          this.pending = null;
          if (pending) this.swap(mounted, pending.graph, pending.center);
        },
        (err) => {
          if (this.mounting === token) this.mounting = null;
          this.logger.error('Failed to render the World Graph', err);
        },
      );
    });

    // A ColorScheme flip re-bakes the colours and nothing else. Remounting would restart the force
    // simulation and throw away the settled layout the reader is looking at, to change a hue.
    effect(() => {
      this.colorScheme.colorScheme();
      this.mounted?.drawing.focus.useColors(graphColors(this.types.all()));
    });

    // The labels follow their box — a Dock Panel dragged wider (ADR-0067), a window resize. cosmos.gl
    // re-reads the canvas size on its own render loop, so the drawing keeps up by itself; the label layer
    // is DOM we own and parks itself once the layout cools, so a resize landing after that would strand
    // every label at the old projection. A repaint is all this is: the framing is the camera's, on the
    // clock it already keeps.
    effect((onCleanup) => {
      const host = this.hostEl().nativeElement;
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() => this.wake());
      observer.observe(host);
      onCleanup(() => observer.disconnect());
    });

    inject(DestroyRef).onDestroy(() => this.teardown());
  }

  private async mount(graph: WorldGraph, center: string | null, host: HTMLDivElement): Promise<Mounted> {
    const { Graph } = await import('@cosmos.gl/graph');

    const payload = graphPayload(graph);
    const { nodes, links } = payload;
    const colors = graphColors(this.types.all());
    const centerIndex = centerPoint(payload, center);
    const { positions, sizes } = seedBuffers(payload, centerIndex);
    // The settle mark describes the payload on screen (a hook for tests waiting on the layout), so a
    // previous mount's must not stand for this one's.
    delete host.dataset['settled'];
    // The drawn mark describes the canvas, so only a new *mount* stands it down — a swap draws on
    // through the one already painted. Taking the marker is what stands it down.
    const markDrawn = firstFrameMark(host);

    // Adopt the pool's pre-warmed graph when one is free: its context creation and shader compile
    // then happened at browser idle, not on this click (see {@link GraphWarmPool}).
    const adopted = this.pool.claim();

    const config: GraphConfig = {
      backgroundColor: colors.background,
      // Colour changes snap unless a render asks for a fade by itself — the hover fade passes its
      // own duration; mount and ColorScheme flips must not inherit cosmos.gl's 800 ms default.
      transitionDuration: 0,
      enableDrag: true,
      // The seed ring is what this frames; `camera` judges it from the first tick onwards, so the
      // default delay is right — a longer one would only stall the first frame.
      fitViewOnInit: true,
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
          id: drawing.payload.nodes[index].id,
          newTab: event.ctrlKey || event.metaKey || event.button === 1,
        }),
      onPointMouseOver: (index) => drawing.focus.hover(index),
      onPointMouseOut: () => drawing.focus.hover(undefined),
      // A pan/zoom shifts the projection and a drag moves the point; both need the label loop awake
      // even when the force simulation is cold. The gesture holds `interacting`; `wake` restarts the
      // loop if it had parked. Dragging also reheats the simulation, which re-drives the loop itself.
      onZoomStart: (_event, userDriven) => {
        // Only a real gesture takes the camera; cosmos's own fit animations report `userDriven: false`.
        if (userDriven) camera.cedeToReader();
        this.startInteracting();
      },
      onZoomEnd: () => (this.interacting = false),
      onDragStart: () => {
        camera.cedeToReader();
        this.startInteracting();
      },
      // Hold the simulation warm for the whole drag, so neighbours ease along with the moved point
      // instead of jumping when it's released. Cooling resumes on its own once the drag ends.
      onDrag: () => cosmos.start(REHEAT_ALPHA),
      onDragEnd: () => (this.interacting = false),
      onSimulationTick: (alpha) => {
        camera.keepFramed();
        markDrawn();
        // The settled mark says the layout is *readable*, not finished: the simulation runs on until alpha
        // crosses 1e-3 (`onSimulationEnd`), so it is set here, at a legible threshold, rather than tens of
        // seconds later. The label loop tracks the points until that real end.
        if (alpha > SETTLED_ALPHA || drawing.settled) return;
        drawing.settled = true;
        host.dataset['settled'] = 'true'; // A hook for tests waiting on the layout.
      },
    };

    // `cosmos`, `camera` and `drawing` are bound below — every handler above them runs later than that.
    let cosmos: Graph;
    if (adopted) {
      cosmos = adopted.graph;
      // The canvas lives in the warm div: give it the host's box, under the label overlay.
      adopted.div.style.cssText = 'width:100%;height:100%;';
      host.prepend(adopted.div);
      cosmos.setConfig(config);
    } else {
      cosmos = new Graph(host, config);
    }

    cosmos.setPointPositions(positions);
    cosmos.setPointSizes(sizes);
    cosmos.setLinks(links);
    // The centre takes no force, so the layout arranges *around* it and the Entity the drawing is about
    // stays where the reader looked for it; cosmos keeps it draggable, which is the one thing that
    // should override this (ADR-0072).
    if (centerIndex >= 0) cosmos.setPinnedPoints([centerIndex]);

    const camera = framingCamera(cosmos, host);
    // Colours come last: the focus layer owns them, and it paints against the data just seeded.
    const drawing: Drawing = {
      payload,
      positions,
      focus: graphFocus({ cosmos, nodes, links, colors, onChange: () => this.wake() }),
      settled: false,
    };

    if (adopted) {
      // Past its init and parked, its warm-render simulation already *ended* — `render(alpha)` and
      // `unpause()` resume nothing then; only `start()` runs a finished simulation again. Frame the
      // seed ring by hand, as `fitViewOnInit` would have.
      cosmos.unpause();
      cosmos.render();
      cosmos.start(1);
      camera.fitNow();
    } else {
      cosmos.render();
    }

    return { cosmos, host, adopted, camera, drawing };
  }

  /**
   * Draw new data through the graph already on screen — a depth flip or a decor reveal (ADR-0072), which
   * change the payload and nothing about the surface. cosmos.gl re-derives its counts and resizes its
   * textures for the new point count on the next `render`, so a swap pays neither context creation nor a
   * shader compile; a remount pays both, on the main thread.
   */
  private swap(mounted: Mounted, graph: WorldGraph, center: string | null): void {
    const { cosmos, camera, drawing, host } = mounted;
    const payload = graphPayload(graph);
    const { nodes, links } = payload;
    const centerIndex = centerPoint(payload, center);

    // Carry every surviving Entity to where it is *now* rather than back to the seed ring, so the
    // drawing grows in place. Positions are read off the graph, which is the only current answer while
    // the label loop is parked.
    const live = cosmos.getPointPositions();
    const carried =
      live.length === drawing.payload.nodes.length * 2 ? positionsById(drawing.payload.nodes, live) : undefined;
    const { positions, sizes, carriedOver } = seedBuffers(payload, centerIndex, carried);
    /** The same Entities in a different set of edges — a decor reveal — rather than a new neighbourhood. */
    const sameEntities = carriedOver === nodes.length && carriedOver === drawing.payload.nodes.length;

    drawing.focus.destroy();
    drawing.payload = payload;
    drawing.positions = positions;
    // The settle mark describes the payload on screen, so it stands down until the new one has cooled.
    drawing.settled = false;
    delete host.dataset['settled'];

    cosmos.setPointPositions(positions);
    cosmos.setPointSizes(sizes);
    cosmos.setLinks(links);
    // By index, and re-applied every swap: the centre keeps its id but `graphPayload` re-orders points.
    cosmos.setPinnedPoints(centerIndex >= 0 ? [centerIndex] : null);
    drawing.focus = graphFocus({
      cosmos,
      nodes,
      links,
      colors: graphColors(this.types.all()),
      onChange: () => this.wake(),
    });
    // `render` is where cosmos.gl adopts the staged data — it re-derives the counts and rebuilds the
    // buffers, textures and programs around them.
    cosmos.render();
    // The same Entities with different edges only need a nudge to re-settle. A different neighbourhood
    // is a different drawing: it needs a real layout, and the camera judges it afresh even if the reader
    // had taken the camera over the last one (ADR-0072 gives them the drawing they were reading).
    cosmos.start(sameEntities ? REHEAT_ALPHA : 1);
    if (!sameEntities) camera.judgeAfresh();
    this.wake();
  }

  /**
   * Destroy a mount. The pool owns everything it handed out — the graph, its device and its div — so an
   * adopted mount is given back rather than destroyed here; only a self-built graph is ours to destroy.
   */
  private destroyMount(mounted: Mounted): void {
    mounted.drawing.focus.destroy();
    if (mounted.adopted) this.pool.retire(mounted.adopted);
    else mounted.cosmos.destroy();
  }

  /**
   * The label pass: `selectLabels` decides *which* Entities and Link Descriptors are labelled, and this
   * projects the winners to the screen and writes the DOM. The loop repaints only while the simulation
   * runs or a drag/pan is in flight ({@link interacting}); when both go quiet it parks itself until
   * {@link wake}.
   *
   * Only ever called on a live mount, past the effect's stale check — the loop it starts owns
   * {@link frame} until {@link teardown} cancels it, across any number of data swaps.
   */
  private paintLabels({ cosmos, host, drawing }: Mounted, overlay: HTMLDivElement): void {
    const tick = () => {
      // Read the drawing per frame, not once: a swap replaces these under the running loop.
      const { payload, positions, focus } = drawing;
      const { nodes, links, descriptors } = payload;
      let used = 0;

      const place = (text: string, x: number, y: number, angle: number | null, opacity: string) => {
        // `max` bounds each election; the DOM ceiling is both of them together.
        if (!text || used >= LABEL_GRID.max * 2) return;
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
        label.style.opacity = opacity;
        label.style.left = `${x}px`;
        label.style.top = `${y}px`;
        label.style.transform = angle === null ? 'translate(-50%, 0)' : `translate(-50%, -100%) rotate(${angle}rad)`;
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

      // Re-read the GPU's positions while anything still moves them. `isSimulationRunning` goes
      // false mid-drag, which is why the loop also stays awake on `interacting`; skipping this read
      // would strand labels where a node used to be. The lengths only disagree if a swap is landing
      // between this frame and the graph's own update — skip that frame rather than throw out of the loop.
      const live = cosmos.getPointPositions();
      if (live.length === positions.length) positions.set(live);

      const selection = selectLabels(payload, positions, currentView(cosmos, host), LABEL_GRID);

      // The labels' opacity follows the crowd. Per span, not on the overlay — a hover-focused name must
      // be able to sit at full strength over a receded crowd, and no child can out-opaque its parent.
      const crowd = (
        selection.visiblePoints <= LABEL_CROWD
          ? 1
          : Math.max(LABEL_MIN_OPACITY, Math.sqrt(LABEL_CROWD / selection.visiblePoints))
      ).toFixed(2);

      const placeNode = (index: number, opacity: string) => {
        const [x, y] = cosmos.spaceToScreenPosition([positions[index * 2], positions[index * 2 + 1]]);
        place(nodeLabel(nodes[index]), x, y + 6, null, opacity);
      };

      // The hovered neighbourhood reads on demand: its names are forced past the election, first —
      // so the DOM ceiling can never squeeze them out — and at full strength.
      const focusedPoints = focus.focused();
      if (focusedPoints) for (const index of focusedPoints) placeNode(index, '1');
      for (const index of selection.points) {
        if (!focusedPoints?.has(index)) placeNode(index, crowd);
      }
      for (const index of selection.links) {
        const source = links[index * 2];
        const target = links[index * 2 + 1];
        const [sx, sy] = cosmos.spaceToScreenPosition([positions[source * 2], positions[source * 2 + 1]]);
        const [tx, ty] = cosmos.spaceToScreenPosition([positions[target * 2], positions[target * 2 + 1]]);
        // Angle in screen space, so the label lies along the edge as drawn, at any zoom.
        place(descriptors[index], (sx + tx) / 2, (sy + ty) / 2, upright(Math.atan2(ty - sy, tx - sx)), crowd);
      }

      for (let i = used; i < this.labels.length; i++) this.labels[i].style.display = 'none';

      // Keep going only while there is motion to track; otherwise park and wait for `wake`.
      this.frame = cosmos.isSimulationRunning || this.interacting ? requestAnimationFrame(tick) : 0;
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
   * event as a zoom, and there is no built-in pan. Pan gestures are intercepted in the capture
   * phase, before d3-zoom sees them; a zoom modifier (pinch or Ctrl/Cmd+wheel) and a *vertical*
   * mouse-wheel notch fall through to the built-in zoom.
   *
   * A horizontal-dominant wheel is *always* taken as a pan, even when it looks like a mouse notch:
   * `preventDefault` on it is what stops the browser reading a leftward two-finger swipe as history
   * back-navigation, and `isTrackpadWheel` keys off `deltaY` alone, so a mostly-sideways swipe can
   * momentarily read as a mouse and leak the event to the browser.
   *
   * There is no `panBy`, so the pan refits the current viewport box, shifted by the swipe, with zero
   * duration and zero padding — same zoom, new centre.
   */
  private enableTwoFingerPan({ cosmos, camera, host }: Mounted): AbortController {
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

      const scale = spaceScale(cosmos);
      if (!scale) return;

      const dx = wheelDeltaPixels(event.deltaX, event, host.clientWidth) / scale;
      // Space y runs opposite screen y here, so the vertical swipe is negated while the horizontal
      // one is not — scrolling down still walks the view down the World, as a scrollbar would.
      const dy = -wheelDeltaPixels(event.deltaY, event, host.clientHeight) / scale;
      const view = currentView(cosmos, host);
      // Shift both corners by the swipe and refit: the box keeps its size (zoom holds) and only its
      // centre moves.
      const box = new Float32Array([view.minX + dx, view.minY + dy, view.maxX + dx, view.maxY + dy]);
      cosmos.setZoomTransformByPointPositions(box, 0, undefined, 0, false);

      camera.cedeToReader();
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
    this.panControls?.abort();
    this.panControls = null;
    this.labels = [];
    // A mount still in flight is disowned here, and destroys itself when it lands.
    this.mounting = null;
    this.pending = null;
    const overlay = this.overlayEl?.()?.nativeElement;
    if (overlay) overlay.textContent = '';
    if (this.mounted) this.destroyMount(this.mounted);
    this.mounted = null;
  }
}

/** Which mount owns a host's drawn mark — a frame callback from an earlier one must not stamp. */
const drawnMarkOwner = new WeakMap<HTMLDivElement, object>();

/**
 * Takes the host's drawn mark for a new mount and returns the marker that stamps it, once cosmos.gl has
 * painted. This is the hook for a test that reads the canvas back, which {@link SETTLED_ALPHA} cannot
 * be: alpha decays once per *rendered frame*, so the settle mark is a frame count (~650 at
 * {@link SIMULATION_DECAY}), and a renderer without a GPU crosses it on no clock a test can name.
 *
 * Two frames, because the caller is `onSimulationTick`, which cosmos.gl invokes *inside* the render
 * pass it is about to submit. Those frames can outlive the mount that asked for them, so the stamp is
 * withheld unless this mount still owns the mark.
 */
function firstFrameMark(host: HTMLDivElement): () => void {
  const owner = {};
  drawnMarkOwner.set(host, owner);
  delete host.dataset['drawn'];
  let marked = false;
  return () => {
    if (marked) return;
    marked = true;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (drawnMarkOwner.get(host) === owner) host.dataset['drawn'] = 'true';
      }),
    );
  };
}

/** Flip an edge label that would otherwise read upside-down. */
function upright(angle: number): number {
  if (angle > Math.PI / 2) return angle - Math.PI;
  if (angle < -Math.PI / 2) return angle + Math.PI;
  return angle;
}
