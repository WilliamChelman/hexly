import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  Type,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  CORE_PANEL_DETAILS,
  CORE_PANEL_LOCAL_GRAPH,
  CORE_VIEW_DETAILS,
  DOCK_PANEL_WIDTH,
  EntityDock,
  GraphWarmPool,
  PANEL_FILTER,
  PanelDefinition,
  PanelId,
  UNIVERSAL_PANELS,
} from '@hexly/web-entity';
import { IconComponent, IconButtonComponent } from '@hexly/web-ui';
import { EntitySession } from '../services/entity-session';
import { EntityViewStore } from '../services/entity-view-store';
import { ViewRegistry } from '../../../entity-types/view-registry';

/** How far one arrow key moves the resize grip — a visible nudge, not a pixel hunt. */
const RESIZE_STEP = 16;

/**
 * The Entity page's **Dock** chrome (ADR-0067): an always-visible toggle strip on the page's right
 * edge, plus the one open Panel beside it. It renders {@link EntityDock}'s slot state; the service
 * itself is page-scoped, provided above the View outlet so a View can claim the slot.
 *
 * It derives the strip synchronously from the **universal** Panels merged with the active View's
 * declared {@link ViewDefinition.panels} — so the toggles are known before any Panel's lazy body loads
 * — and write-gates each against {@link EntitySession.writable} (ADR-0037). The open Panel's body is fetched
 * on first open and outletted; a View-contributed Panel is outletted with the running View's injector
 * ({@link EntityDock.viewInjector}, #294), so it reaches the View-scoped services its host View provides.
 *
 * It *floats* over the main content (ADR-0067): the whole Dock is a flex row `[panel][strip]` pinned to
 * the page body's top-right, inset from the edges, as a rounded card + rounded toggle strip with a
 * shadow — never a solid flush column, and it never pushes the content. A full-bleed View (Map, Board)
 * lets it float over the corner; a reading-column View insets its own content so nothing is covered
 * (the page owns that, keyed off {@link ViewDefinition.layout}). The floating gaps are click-through
 * (`pointer-events-none` on the row, `-auto` on the card and strip) so they never eat a map gesture.
 *
 * The Panel card is **resizeable** from a grip on its left edge — a References list and an Outline want
 * very different widths. The width itself is the {@link EntityDock}'s (remembered per user, clamped
 * there); this component only turns a drag or an arrow key into it. A reading-column View follows the
 * width through the page's `--_dock-panel-width`, so a widened Panel still never covers the column.
 */
@Component({
  selector: 'app-entity-dock',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Inset 1.5rem all sides (ADR-0067): the top meets the reading column's `py-6`, so content and Dock line
  // up. The row spans the body rather than sizing to its content, so a Panel wider than the body shrinks
  // to fit instead of sliding its left edge — and the grip on it — out through the body's clipped edge;
  // it stays click-through, so spanning the width costs no gesture.
  host: { class: 'absolute inset-6 z-10 flex items-start justify-end gap-2 pointer-events-none' },
  imports: [NgComponentOutlet, IconComponent, IconButtonComponent, TranslocoPipe],
  styles: `
    @reference '#app-styles.css';
    /* A wide-enough grab target, drawn as a hairline rule only while it is hovered, focused, or dragged —
       the Panel's edge stays a clean border until the reader reaches for it. */
    .resize-handle {
      @apply absolute inset-y-0 left-0 z-10 w-3 cursor-col-resize touch-none;
    }
    .resize-handle::after {
      @apply absolute inset-y-2 left-[5px] w-0.5 rounded-full bg-transparent transition-colors content-[''];
    }
    .resize-handle:hover::after {
      @apply bg-line-strong;
    }
    /* The card is \`overflow-hidden\`, which clips the global focus ring (base.css draws it as a
       box-shadow) to a sliver — so focus is carried by the grip's own rule, widened and in the accent, which
       clears 3:1 against the card in both themes where the hover hairline does not. */
    .resize-handle:focus-visible::after,
    .resize-handle.is-resizing::after {
      @apply w-1 bg-accent;
    }
  `,
  template: `
    <!-- The open Panel's card stays mounted the whole time a Panel is open — keyed off the slot, not the
         lazily-fetched body — so switching to a not-yet-loaded Panel never collapses the card and
         flickers it closed/reopen (ADR-0067). The body outlets in once its deferred chunk resolves. -->
    @if (dock.openPanel()) {
      <!-- \`min-w-0\` against the row's own width: the remembered width is honoured while the body has
           room for it, and the card gives way rather than sliding its left edge — and the grip on it —
           out through the body's \`overflow-hidden\` on a window too narrow to seat it. -->
      <div
        id="dock-panel"
        data-testid="dock-panel"
        class="pointer-events-auto relative flex max-h-full min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-2"
        [style.width.px]="dock.panelWidth()"
      >
        <!-- Resize grip on the Panel's inner left edge — a focusable window splitter, so the width is
             reachable by keyboard too. It rides *inside* the card (which is \`overflow-hidden\`) rather
             than in the floating gap, which stays click-through for the map gesture underneath; it is as
             wide as the Panel bodies' own \`p-3\` gutter, so it takes no click their content wanted. -->
        <div
          class="resize-handle"
          data-testid="dock-resize"
          role="separator"
          aria-orientation="vertical"
          aria-controls="dock-panel"
          tabindex="0"
          [attr.aria-label]="'editorShell.dock.resize' | transloco"
          [attr.aria-valuenow]="dock.panelWidth()"
          [attr.aria-valuemin]="bounds.min"
          [attr.aria-valuemax]="bounds.max"
          [attr.aria-valuetext]="'editorShell.dock.resizeValue' | transloco: { width: dock.panelWidth() }"
          [class.is-resizing]="dock.resizing()"
          (pointerdown)="onResizeStart($event)"
          (pointermove)="onResizeMove($event)"
          (pointerup)="onResizeEnd($event)"
          (pointercancel)="onResizeEnd($event)"
          (lostpointercapture)="onResizeEnd($event)"
          (dblclick)="onResizeReset()"
          (keydown)="onResizeKey($event)"
          (keyup)="dock.endResize()"
        ></div>
        @if (openPanelBody(); as body) {
          <ng-container *ngComponentOutlet="body.component; injector: body.injector" />
        }
      </div>
    }
    <!-- Always-visible floating strip: one toggle per available Panel, known before any lazy body loads. -->
    <div
      data-testid="dock-strip"
      class="pointer-events-auto flex shrink-0 flex-col items-center gap-2 rounded-lg border border-line bg-surface-sunken p-1.5 shadow-2"
    >
      @for (panel of dock.available(); track panel.id) {
        <button
          appIconButton
          toggle
          [active]="dock.openPanel()?.id === panel.id"
          [title]="panel.labelKey | transloco"
          [attr.aria-label]="panel.labelKey | transloco"
          [attr.data-testid]="toggleTestId(panel.id)"
          (click)="dock.toggle(panel.id)"
        >
          <app-icon [name]="panel.icon" [size]="20" />
        </button>
      }
    </div>
  `,
})
export class EntityDockComponent {
  protected readonly dock = inject(EntityDock);
  private readonly views = inject(ViewRegistry);
  private readonly viewStore = inject(EntityViewStore);
  private readonly session = inject(EntitySession);
  private readonly panelFilter = inject(PANEL_FILTER);
  private readonly graphPool = inject(GraphWarmPool);

  /** Lazily-fetched Panel bodies, keyed by Panel id; never evicted (a component class is stable). */
  private readonly loaded = signal<ReadonlyMap<PanelId, Type<unknown>>>(new Map());

  /** The bounds the grip reports to assistive tech; the Dock is what actually holds a resize to them. */
  protected readonly bounds = DOCK_PANEL_WIDTH;

  /** The live drag, or `null` between gestures. Plain state: nothing renders off it. */
  private drag: { pointerId: number; startX: number; startWidth: number } | null = null;

  /**
   * The Panels the current View offers: the universal set merged with the active View's declared
   * Panels, kept through the page's {@link PANEL_FILTER} (a Public Link page drops References), then
   * minus any write-gated Panel a read-only viewer may not have (ADR-0037).
   */
  private readonly availablePanels = computed<readonly PanelDefinition[]>(() => {
    const activeView = this.viewStore.activeView().viewId;
    const view = this.views.resolve(activeView).panels ?? [];
    const writable = this.session.writable();
    // The fallback Details View already renders the Details Panel's substance full-width as the main
    // content (ADR-0067), so the Dock dropping the redundant Details toggle there — the same substance
    // would otherwise show twice.
    const redundant = activeView === CORE_VIEW_DETAILS ? CORE_PANEL_DETAILS : null;
    return [...UNIVERSAL_PANELS, ...view].filter(
      (panel) => panel.id !== redundant && this.panelFilter(panel) && (!panel.writeGate || writable),
    );
  });

  constructor() {
    // The Local Graph Panel is a toggle away, so its graph is warmed while the reader reads rather
    // than on the click (GraphWarmPool). Gated on the Panel being offered here: the warm-up holds a
    // live WebGL context for as long as the page does, which a surface that cannot open the Panel
    // (a Public Link page, ADR-0072) must not pay. `warmUp` is idempotent, so re-runs are free.
    effect(() => {
      if (this.availablePanels().some((panel) => panel.id === CORE_PANEL_LOCAL_GRAPH)) this.graphPool.warmUp();
    });

    // Feed the derived availability into the page-scoped Dock, which resolves the open slot against it
    // (close-don't-substitute when the remembered Panel drops out of the set).
    effect(() => this.dock.setAvailable(this.availablePanels()));

    // Fetch the open Panel's deferred body once, on first open.
    effect(() => {
      const panel = this.dock.openPanel();
      if (panel && !panel.component && !this.loaded().has(panel.id)) untracked(() => this.fetch(panel));
      // The card can go while a drag holds it — a live rights change, a View swap, a claim. The grip
      // unmounts with it and its release is never delivered, so the gesture is closed here rather than
      // left holding `resizing` true for the life of the page.
      if (!panel && this.drag) untracked(() => this.endDrag());
    });
  }

  /**
   * The open Panel's body and the injector to create it in — `undefined` while a deferred body is still
   * in flight, or while a View-contributed Panel awaits its View's injector.
   *
   * A **universal** Panel (References, Details) resolves against the Dock's own page injector, so it takes
   * no injector here. A **View-contributed** Panel (the Content View's Outline) is instantiated with the
   * running View's injector (ADR-0067, #294) so it reaches the View-scoped services its host View provides
   * (the Outline's `OutlineStore`); it is withheld until that injector arrives, so it never constructs
   * against the wrong scope.
   */
  protected readonly openPanelBody = computed<{ component: Type<unknown>; injector?: Injector } | undefined>(() => {
    const panel = this.dock.openPanel();
    if (!panel) return undefined;
    const component = panel.component ?? this.loaded().get(panel.id);
    if (!component) return undefined;
    if (UNIVERSAL_PANELS.some((p) => p.id === panel.id)) return { component };
    const injector = this.dock.viewInjector();
    return injector ? { component, injector } : undefined;
  });

  private fetch(panel: PanelDefinition): void {
    panel.loadComponent?.().then((component) => this.loaded.update((m) => new Map(m).set(panel.id, component)));
  }

  /** A stable, readable toggle testid from the Panel id's last segment (`core.panel.references` → `references-toggle`). */
  protected toggleTestId(id: PanelId): string {
    return `${id.split('.').pop()}-toggle`;
  }

  protected onResizeStart(event: PointerEvent): void {
    // Primary button only, and one gesture at a time: a second finger must not seize a live drag and
    // carry it off from its own start point.
    if (event.button !== 0 || this.drag) return;
    // Swallow the press so it neither starts a text selection nor reaches the View underneath.
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    this.drag = { pointerId: event.pointerId, startX: event.clientX, startWidth: this.dock.panelWidth() };
    this.dock.beginResize();
  }

  protected onResizeMove(event: PointerEvent): void {
    // A second pointer must never disturb the gesture in flight.
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    // No button held is a gesture whose end was lost (a release off-window, a capture torn away with the
    // grip). End it here rather than resize on a bare hover — a mouse always carries pointerId 1, so a
    // stale drag would otherwise adopt the next pass of the cursor.
    if (event.buttons === 0) return this.endDrag();
    // The Panel is pinned to the page's right edge, so it grows as the grip travels left.
    this.dock.resizePanel(this.drag.startWidth + (this.drag.startX - event.clientX));
  }

  protected onResizeEnd(event: PointerEvent): void {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    // A mouse's buttons share one pointerId, so the *right* button's release arrives here mid-drag while
    // the left is still down; it is not this gesture's end.
    if (event.type === 'pointerup' && event.button !== 0) return;
    this.endDrag();
  }

  /**
   * Keyboard resize on the focused grip: left widens, right narrows — the drag's directions — and Home
   * restores the default, the one way back from a width dragged past the window.
   *
   * Held as a gesture, like a drag: the repeat while the key is down moves the Panel, and the release
   * remembers it, so auto-repeat doesn't write storage thirty times a second.
   */
  protected onResizeKey(event: KeyboardEvent): void {
    const width =
      event.key === 'ArrowLeft'
        ? this.dock.panelWidth() + RESIZE_STEP
        : event.key === 'ArrowRight'
          ? this.dock.panelWidth() - RESIZE_STEP
          : event.key === 'Home'
            ? DOCK_PANEL_WIDTH.default
            : null;
    if (width === null) return;
    event.preventDefault();
    this.dock.beginResize();
    this.dock.resizePanel(width);
  }

  /** A double-click on the grip restores the default width — the pointer's Home. */
  protected onResizeReset(): void {
    this.dock.resizePanel(DOCK_PANEL_WIDTH.default);
    this.dock.endResize();
  }

  private endDrag(): void {
    this.drag = null;
    this.dock.endResize();
  }
}
