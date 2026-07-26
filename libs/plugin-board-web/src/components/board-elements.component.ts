import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  HostListener,
  inject,
  input,
  signal,
  viewChildren,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { EmbedElement, ImageElement, Point, Size, stackingOrder, TextElement } from '@hexly/plugin-board';
import { isInteractiveTarget, ShortcutService } from '@hexly/web-core';
import { BoardCamera } from '../services/board-camera';
import { BoardStore } from '../services/board-store';
import { DRAG_THRESHOLD } from '../utils/gesture';
import { BoardImageComponent } from './board-image.component';
import { BoardEmbedComponent } from './board-embed.component';
import { BoardElementControlsComponent } from './board-element-controls.component';
import { TextBlockComponent } from './text-block.component';
import { TOOLS, toolForHotkey } from './tools';

/** A resize handle's compass direction — the edge(s) it drags. A closed union, like {@link ToolId}. */
export type Corner = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** The eight resize handles, by compass direction — the edges each drags, its cursor, and its corner. */
interface Handle {
  readonly dir: Corner;
  readonly cursor: string;
  /** Tailwind position utilities placing the handle on the element's box. */
  readonly at: string;
}

const HANDLES: readonly Handle[] = [
  { dir: 'nw', cursor: 'nwse-resize', at: '-top-1 -left-1' },
  { dir: 'n', cursor: 'ns-resize', at: '-top-1 left-1/2 -translate-x-1/2' },
  { dir: 'ne', cursor: 'nesw-resize', at: '-top-1 -right-1' },
  { dir: 'e', cursor: 'ew-resize', at: 'top-1/2 -right-1 -translate-y-1/2' },
  { dir: 'se', cursor: 'nwse-resize', at: '-bottom-1 -right-1' },
  { dir: 's', cursor: 'ns-resize', at: '-bottom-1 left-1/2 -translate-x-1/2' },
  { dir: 'sw', cursor: 'nesw-resize', at: '-bottom-1 -left-1' },
  { dir: 'w', cursor: 'ew-resize', at: 'top-1/2 -left-1 -translate-y-1/2' },
];

/** Smallest a resize may shrink an element, in world pixels — a positive floor `sizeSchema` demands. */
const MIN_SIZE = 20;

/** The per-kind aria-label keys, so assistive tech hears an element's kind (en/fr catalogs, ADR-0014). */
const ELEMENT_LABEL_KEYS: Readonly<Record<string, string>> = {
  box: 'board.canvas.elementBox',
  text: 'board.canvas.elementText',
  image: 'board.canvas.elementImage',
  embed: 'board.canvas.elementEmbed',
};

/** World pixels an arrow key nudges the selection — Shift multiplies it tenfold. */
const NUDGE_STEP = 1;
const NUDGE_STEP_SHIFT = 10;

/** The world direction each arrow key nudges in, keyed by lowercase `event.key`. */
const NUDGE_DIRECTION: Readonly<Record<string, Point>> = {
  arrowleft: { x: -1, y: 0 },
  arrowright: { x: 1, y: 0 },
  arrowup: { x: 0, y: -1 },
  arrowdown: { x: 0, y: 1 },
};

/** One element resolved for the DOM: its screen-space box, its selection/armed state, and its content. */
interface Rendered {
  readonly id: string;
  readonly left: number;
  readonly top: number;
  /** The element's **world** size (its content's natural dimensions); the box scales it by {@link scale}. */
  readonly width: number;
  readonly height: number;
  /** The camera zoom the content is CSS-scaled by, so prose/images/nested embeds zoom with the box. */
  readonly scale: number;
  readonly selected: boolean;
  /** Whether this element is the armed one — its editor is live, so drag/resize is suppressed on it. */
  readonly armed: boolean;
  /** The Text Block element to render in place, or null for any other kind (Box, Image, Embed). */
  readonly text: TextElement | null;
  /** The Image element to render in place, or null for any other kind. */
  readonly image: ImageElement | null;
  /** The Embed element to render in place, or null for any other kind. */
  readonly embed: EmbedElement | null;
  /** The box's per-kind aria-label key — a screen reader hears *what* the element is, not just "element". */
  readonly labelKey: string;
}

/**
 * A live drag — moving the whole selection, resizing one element from a handle, or a middle-button pan.
 * Every kind pins `pointerId` (only its own pointer's events drive or end it — a second touch mid-drag
 * must not hijack the gesture, mirroring the canvas's `foreignPointer`) and move/resize freeze `zoom` at
 * the press: dividing by the *live* zoom would snap the element under a stationary pointer if a pinch
 * lands mid-drag.
 */
type Gesture =
  | {
      kind: 'move';
      pointerId: number;
      zoom: number;
      startX: number;
      startY: number;
      id: string;
      group: boolean;
      moved: boolean;
    }
  | {
      kind: 'resize';
      pointerId: number;
      zoom: number;
      startX: number;
      startY: number;
      id: string;
      dir: Corner;
      origin: { position: Point; size: Size };
      /** The width/height to hold constant (a ratio-locked Image), or undefined for a free resize. */
      lockAspect?: number;
    }
  /** Middle-button pan started over an element box — the grid's pan affordance, kept alive over content. */
  | { kind: 'pan'; pointerId: number; lastX: number; lastY: number };

/**
 * The Board Elements overlay: the DOM layer above the canvas grid that draws each Board Element as a
 * positioned box and owns the element-level gestures — Select picks on click, a selected element drags
 * to move and resizes via handles, and multiple selected elements move together (CONTEXT.md → Select,
 * #267). Rendered in the DOM (not on the `<canvas>`) because this is the seam the Text Block (#268) and
 * Image (#269) kinds hang their real content off — a `contenteditable` editor and an `<img>` can't live
 * on a 2D canvas.
 *
 * Reads the shared {@link BoardCamera} so its boxes track the grid under pan/zoom, and drives every
 * document change through the {@link BoardStore}. A drag/resize previews locally and commits once on
 * release, so the whole gesture is one undo step. The host is `pointer-events-none` and each element box
 * re-enables the pointer, so a press on empty plane falls through to the canvas below (pan / place /
 * deselect).
 *
 * Set {@link readOnly} for a read-only viewer or an Embed's live transclusion (ADR-0037/0062): the layer
 * still draws every element (so a transcluded Board shows its content, not a bare grid, and nested Embeds
 * mount), but affords no editing — no select/drag/resize, no arm, and no keyboard mutation. The Embed's
 * own open-target affordance is unaffected (it owns its pointer). This mirrors the Hex Map View, whose
 * content canvas renders outside the writable gate and whose editing chrome alone is gated.
 */
@Component({
  selector: 'app-board-elements',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'absolute inset-0 pointer-events-none overflow-hidden' },
  imports: [TranslocoPipe, TextBlockComponent, BoardImageComponent, BoardEmbedComponent, BoardElementControlsComponent],
  template: `
    @for (el of rendered(); track el.id) {
      <div
        class="element"
        [class.is-readonly]="readOnly()"
        [class.is-selected]="el.selected"
        [class.is-armed]="el.armed"
        [class.is-text]="!!el.text"
        [class.is-image]="!!el.image"
        [class.is-embed]="!!el.embed"
        [style.left.px]="el.left"
        [style.top.px]="el.top"
        [style.width.px]="el.width * el.scale"
        [style.height.px]="el.height * el.scale"
        [attr.data-testid]="'element-' + el.id"
        [attr.aria-label]="el.labelKey | transloco"
        (pointerdown)="onElementDown(el.id, $event)"
        (dblclick)="onElementDblClick(el.id)"
      >
        <!-- Content wrapper at the element's *world* size, scaled by the camera zoom (origin top-left).
             The scaled footprint equals the box's screen size, so the box's chrome (border, selection
             outline, handles) stays crisp in screen space while the prose/image/embed inside zooms.
             Applied only when it isn't 1, so an unzoomed board carries no transform at all. A Text Block's
             inline editor popups are position:fixed and would be trapped by this transform; they escape it
             by rendering at <body> (appBodyPortal), so they stay anchored to the caret at any zoom. -->
        <div
          class="content"
          [style.width.px]="el.width"
          [style.height.px]="el.height"
          [style.scale]="el.scale === 1 ? null : el.scale"
        >
          @if (el.text; as text) {
            <app-board-text-block [element]="text" />
          }
          @if (el.image; as image) {
            <app-board-image [element]="image" />
          }
          @if (el.embed; as embed) {
            <app-board-embed [element]="embed" />
          }
        </div>
        @if (!readOnly() && el.selected && single() && !el.armed) {
          @for (h of handles; track h.dir) {
            <span
              class="handle {{ h.at }}"
              [style.cursor]="h.cursor"
              [attr.data-testid]="'handle-' + h.dir"
              (pointerdown)="onHandleDown(el.id, h.dir, $event)"
            ></span>
          }
        }
      </div>
      <!-- The selection control strip for an Image/Embed/Text Block (CONTEXT.md → Image/Embed/Text Block):
           a sibling of the box, not a child — an Image/Embed box is overflow-hidden and would clip a toolbar
           floated above its top edge. Boxes (no kind-specific controls) show none. -->
      @if (!readOnly() && el.selected && single() && (el.image || el.embed || el.text)) {
        <app-board-element-controls [element]="(el.image ?? el.embed ?? el.text)!" [left]="el.left" [top]="el.top" />
      }
    }
  `,
  styles: `
    @reference '#app-styles.css';

    /* Element boxes must stay z-index: auto — the floating chrome (palette, Inspector, zoom control)
       relies on its z-[1] beating tree order in the board View's stacking context (see the canvas host's
       deliberately-not-isolate note); any z-index here would paint boxes over the chrome's controls. */
    .element {
      @apply absolute pointer-events-auto rounded-sm cursor-move;
      background: color-mix(in srgb, var(--color-accent-soft) 55%, transparent);
      border: 1px solid var(--color-line-strong);
    }
    /* World-sized content scaled by the camera zoom from the box's top-left, so its scaled footprint
       fills the screen-sized box exactly (see the template). Origin top-left is what aligns them. */
    .content {
      transform-origin: 0 0;
    }
    /* Read-only (a read-only viewer or an Embed's transclusion, ADR-0037/0062): the element renders its
       content but affords no move — no drag, no handles, no selection chrome. */
    .element.is-readonly {
      @apply cursor-default;
    }
    /* A Text Block reads as paper carrying prose, not an accent placeholder; armed, it invites a caret. */
    .element.is-text {
      @apply bg-surface-raised;
      border-color: var(--color-line);
    }
    /* An Image frames its own Asset — a quiet sunken mat behind the letterboxed picture, not the accent. */
    .element.is-image {
      @apply bg-surface-sunken overflow-hidden;
      border-color: var(--color-line);
    }
    /* An Embed frames the transcluded View — a neutral window, its substance the target's own. */
    .element.is-embed {
      @apply bg-surface overflow-hidden;
      border-color: var(--color-line);
    }
    .element.is-armed {
      @apply cursor-text;
    }
    .element.is-selected {
      border-color: var(--color-accent);
      box-shadow: 0 0 0 1px var(--color-accent);
    }
    .handle {
      @apply absolute w-2 h-2 rounded-full pointer-events-auto;
      background: var(--color-accent);
      border: 1px solid var(--color-on-accent-sheen, #fff);
    }
  `,
})
export class BoardElementsComponent {
  private readonly cam = inject(BoardCamera);
  private readonly store = inject(BoardStore);
  private readonly shortcuts = inject(ShortcutService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * Read-only rendering (ADR-0037/0062): the elements draw but afford no editing — no select/drag/resize,
   * no arm, no keyboard mutation. Drives a read-only viewer and an Embed's transclusion off one component.
   */
  readonly readOnly = input(false);

  protected readonly handles = HANDLES;

  /** The mounted Text Blocks, looked up by element id when arming must move focus into an editor. */
  private readonly textBlocks = viewChildren(TextBlockComponent);

  /** A live move offset in world pixels, applied to every selected element as a preview. */
  private readonly moveDelta = signal<Point | null>(null);
  /** A live resize preview for one element, in world coordinates. */
  private readonly resizePreview = signal<{ id: string; position: Point; size: Size } | null>(null);

  /** Whether exactly one element is selected — resize handles show only then (single-element geometry). */
  protected readonly single = computed(() => this.store.selectedElement() !== null);

  /** The active gesture; a plain field, not a signal — it gates the gesture, never the render. */
  private gesture: Gesture | null = null;

  /**
   * Whether a gesture is in flight, mirrored reactively for the board View: it must stop forwarding
   * wheels to the camera mid-drag, or the pan/zoom would move the board under the frozen gesture math.
   */
  private readonly _gestureActive = signal(false);
  readonly gestureActive = this._gestureActive.asReadonly();

  constructor() {
    this.registerShortcuts();

    // Focus follows arming (any path: double-click, or the Text Tool's addText which arms on placement).
    // Without it focus stays on <body>, so the next Backspace would ride the surface layer and delete the
    // just-opened element, and a caret needs a third click. afterRenderEffect, not effect: the editor
    // turns editable during this CD pass and the viewChildren query settles with the render.
    afterRenderEffect(() => {
      const armed = this.store.armed();
      if (armed === null || this.readOnly()) return;
      this.textBlocks()
        .find((block) => block.element().id === armed)
        ?.focus();
    });
  }

  /**
   * Every element resolved to a screen-space box in stacking order (bottom first, so the DOM paint order
   * is the stack), folding in any live move/resize preview so a drag renders before it commits.
   */
  protected readonly rendered = computed<Rendered[]>(() => {
    const camera = this.cam.camera();
    const selected = new Set(this.store.selectedIds());
    const armed = this.store.armed();
    const move = this.moveDelta();
    const resize = this.resizePreview();
    return stackingOrder(this.store.document()).map((el) => {
      let position = el.position;
      let size = el.size;
      if (resize && resize.id === el.id) {
        position = resize.position;
        size = resize.size;
      } else if (move && selected.has(el.id)) {
        position = { x: position.x + move.x, y: position.y + move.y };
      }
      const screen = camera.worldToScreen(position);
      return {
        id: el.id,
        left: screen.x,
        top: screen.y,
        // World size, not screen size: the box's *content* renders at these dimensions and a CSS
        // `scale` on the inner wrapper zooms it, so text/images/nested embeds scale with the box rather
        // than reflowing into a shrunken frame at native size (the reported bug).
        width: size.width,
        height: size.height,
        scale: camera.zoom,
        selected: selected.has(el.id),
        armed: armed === el.id,
        text: el.kind === 'text' ? el : null,
        image: el.kind === 'image' ? el : null,
        embed: el.kind === 'embed' ? el : null,
        labelKey: ELEMENT_LABEL_KEYS[el.kind] ?? 'board.canvas.elementBox',
      };
    });
  });

  // ---- Element press: pick, then arm a move ---------------------------------

  protected onElementDown(id: string, event: PointerEvent): void {
    // Read-only: no pick/move gesture, and no stopPropagation, so the press is inert (ADR-0062).
    if (this.readOnly()) return;
    // A press while a gesture is live is a second pointer (multi-touch): the first keeps the gesture.
    if (this.gesture !== null) return;
    // An armed element owns the pointer for its interaction (typing, an Embed's read-interaction): let
    // every press reach it and start no gesture — dragging requires disarming first (CONTEXT.md → #268).
    if (this.store.armed() === id) return;
    // Middle button pans, exactly as it does on the grid — an element box must not be a dead spot in the
    // pan surface. Nothing to commit: the camera moves live and the release is inert.
    if (event.button === 1) {
      event.stopPropagation();
      (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
      this.setGesture({ kind: 'pan', pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY });
      return;
    }
    if (event.button !== 0) return;
    event.stopPropagation();
    // Capture on the box (currentTarget), not event.target: the press may land on a child that unmounts
    // mid-gesture, and a removed capture element silently drops the rest of the drag.
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);

    const modifier = event.shiftKey || event.metaKey || event.ctrlKey;
    const alreadySelected = this.store.selectedIds().includes(id);
    // A plain press on an already-selected element defers to a group move — the collapse to just this
    // element waits for a plain release, so click-to-narrow still works after a multi-select.
    const group = !modifier && alreadySelected;
    if (!group) {
      const mode = event.shiftKey ? 'add' : event.metaKey || event.ctrlKey ? 'toggle' : 'replace';
      this.store.select(id, mode);
    }
    // Arm the move only if the pressed element ended up selected (a toggle-off leaves nothing to drag).
    if (!this.store.selectedIds().includes(id)) return;
    this.setGesture({
      kind: 'move',
      pointerId: event.pointerId,
      zoom: this.cam.zoom(),
      startX: event.clientX,
      startY: event.clientY,
      id,
      group,
      moved: false,
    });
  }

  /**
   * Double-click **arms** an interactive element (CONTEXT.md → Text Block/Embed, #268/#270): a plain click
   * selects and can drag, a second click into it hands the pointer to the element — a Text Block's inline
   * editor, or an Embed's read-interaction (pan / scroll / click-through). The static kinds (Box, Image)
   * have no active mode, so the double-click is inert on them.
   */
  protected onElementDblClick(id: string): void {
    if (this.readOnly()) return; // no arming a transcluded/read-only element (ADR-0062).
    const element = this.store.document().elements.find((e) => e.id === id);
    if (element?.kind !== 'text' && element?.kind !== 'embed') return;
    this.store.select(id, 'replace');
    this.store.arm(id);
  }

  // ---- Handle press: resize -------------------------------------------------

  protected onHandleDown(id: string, dir: Corner, event: PointerEvent): void {
    if (this.readOnly()) return; // handles never render read-only, but guard the entry too.
    if (this.gesture !== null) return; // a second pointer must not overwrite a live gesture.
    if (event.button !== 0) return;
    event.stopPropagation();
    // Capture on the element box, not the handle span: handles unmount if the selection flips mid-drag,
    // and a removed capture element drops the pointer stream; the box outlives the gesture.
    const box = (event.currentTarget as Element).closest('.element') ?? (event.currentTarget as Element);
    box.setPointerCapture?.(event.pointerId);
    const element = this.store.document().elements.find((e) => e.id === id);
    if (!element) return;
    // A ratio-locked Image holds its current aspect through the drag; every other element resizes freely.
    const lockAspect =
      element.kind === 'image' && element.lockRatio ? element.size.width / element.size.height : undefined;
    this.setGesture({
      kind: 'resize',
      pointerId: event.pointerId,
      zoom: this.cam.zoom(),
      startX: event.clientX,
      startY: event.clientY,
      id,
      dir,
      origin: { position: { ...element.position }, size: { ...element.size } },
      lockAspect,
    });
  }

  // ---- Global drag tracking -------------------------------------------------

  @HostListener('document:pointermove', ['$event'])
  protected onPointerMove(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return; // foreign pointer: not this gesture's.
    // No button held means the pointerup was lost (released outside the window, a missed capture):
    // abandon rather than rubber-band the element around on plain hover until the next click.
    if (event.buttons === 0) {
      this.clearGesture();
      return;
    }
    if (gesture.kind === 'pan') {
      this.cam.panBy(event.clientX - gesture.lastX, event.clientY - gesture.lastY);
      gesture.lastX = event.clientX;
      gesture.lastY = event.clientY;
      return;
    }
    // The zoom frozen at the press, not the live camera: a pinch mid-drag must not snap the element
    // under a stationary pointer (the View also stops forwarding wheels while a gesture is live).
    const worldDx = (event.clientX - gesture.startX) / gesture.zoom;
    const worldDy = (event.clientY - gesture.startY) / gesture.zoom;

    if (gesture.kind === 'move') {
      if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) >= DRAG_THRESHOLD) {
        gesture.moved = true;
      }
      if (gesture.moved) this.moveDelta.set({ x: worldDx, y: worldDy });
      return;
    }
    this.resizePreview.set({
      id: gesture.id,
      ...resizeGeometry(gesture.origin, gesture.dir, worldDx, worldDy, gesture.lockAspect),
    });
  }

  @HostListener('document:pointerup', ['$event'])
  protected onPointerUp(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return; // a foreign pointer ends nothing.
    (event.target as Element).releasePointerCapture?.(event.pointerId);

    if (gesture.kind === 'move') {
      const delta = this.moveDelta();
      if (gesture.moved && delta) {
        this.store.moveSelected(delta);
      } else if (gesture.group) {
        // A plain click that never dragged collapses the set to the pressed element.
        this.store.select(gesture.id, 'replace');
      }
    } else if (gesture.kind === 'resize') {
      const preview = this.resizePreview();
      if (preview) this.store.setGeometry(gesture.id, preview.position, preview.size);
    }
    // A pan commits nothing — the camera already moved live.
    this.clearGesture();
  }

  @HostListener('document:pointercancel', ['$event'])
  protected onPointerCancel(event: PointerEvent): void {
    if (!this.gesture || event.pointerId !== this.gesture.pointerId) return;
    // Abandon the gesture without committing — a cancelled drag never lands at a stale destination.
    this.clearGesture();
  }

  // ---- Keyboard -------------------------------------------------------------

  /**
   * The board's keyboard contract, as `surface`-layer registrations on the app's one shortcut
   * dispatcher (ADR-0063) — so a modal picker or a focused text field suppresses them wholesale, and
   * exact modifier matching keeps Alt/Ctrl-chords from re-arming Tools. Delete/Backspace removes the
   * selection, Cmd/Ctrl+Z / Shift+Z undoes/redoes (plus Ctrl+Y, the Windows/Linux redo), letters arm
   * Tools, arrows nudge the selection, and Escape unwinds one layer of mode at a time.
   *
   * Every registration is gated on `!readOnly()` — load-bearing for an Embed: the dispatcher is
   * window-level, so a transcluded read-only board must not mutate its store off the outer page's keys.
   * Every *mutating* shortcut is additionally gated on no live gesture: an undo mid-resize would be
   * clobbered by the pending commit replaying a pre-undo origin on release. Delete/Backspace also falls
   * through behind a focused control ({@link isInteractiveTarget}), mirroring the map canvas.
   *
   * Registered in the constructor's injection context, so they unregister with the component.
   */
  private registerShortcuts(): void {
    const writable = () => !this.readOnly();
    const idle = () => !this.readOnly() && this.gesture === null;

    // Escape unwinds exactly one layer per press, strongest claim first:
    // (1) a live drag/resize — cancel it, committing nothing and leaving the selection (a multi-select
    //     mid-move survives; the release after a cancel is inert);
    // (2) an armed element — disarm only, keeping the selection;
    // (3) an armed placement Tool — back to Select, so an armed placement can be abandoned;
    // (4) nothing else claimed — clear the selection.
    this.shortcuts.register({
      layer: 'surface',
      keys: 'escape',
      when: writable,
      handler: () => {
        if (this.cancelGesture()) return;
        if (this.store.armed() !== null) {
          this.store.disarm();
          return;
        }
        if (this.store.tool() !== 'select') {
          this.store.armTool('select');
          return;
        }
        this.store.deselect();
      },
    });

    // Escape from *inside* the armed editor (the `editable` layer): disarm, keep the selection, and
    // hand focus back to the surface — without the blur, focus stays in the now read-only editor and
    // every subsequent key keeps riding the editable layer. This used to be impossible: the old
    // handler bailed on editable targets, mouse-trapping authors in edit mode. Claimed only while the
    // focused editable actually sits inside this board's host: the dispatcher is window-level, so an
    // armed block must not hijack Escape from a foreign text field (disarming it, blurring the field,
    // and preventDefaulting the keydown out from under whoever owns that field).
    this.shortcuts.register({
      layer: 'editable',
      keys: 'escape',
      when: () => !this.readOnly() && this.store.armed() !== null,
      handler: () => {
        if (!this.host.nativeElement.contains(document.activeElement)) return false;
        this.store.disarm();
        (document.activeElement as HTMLElement | null)?.blur?.();
        return;
      },
    });

    this.shortcuts.register({
      layer: 'surface',
      keys: ['delete', 'backspace'],
      when: idle,
      handler: (event) => {
        // Suppressed behind any focused control (palette/Inspector buttons, links), mirroring the map
        // canvas: the destructive shortcut belongs to the surface, never to a focused button.
        if (isInteractiveTarget(event.target)) return false;
        this.store.delete();
        return;
      },
    });

    this.shortcuts.register({ layer: 'surface', keys: 'mod+z', when: idle, handler: () => this.store.undo() });
    this.shortcuts.register({
      layer: 'surface',
      keys: ['mod+shift+z', 'ctrl+y'],
      when: idle,
      handler: () => this.store.redo(),
    });

    this.shortcuts.register({
      layer: 'surface',
      keys: TOOLS.map((t) => t.hotkey),
      when: idle,
      handler: (event) => {
        const tool = toolForHotkey(event.key);
        if (!tool) return false;
        this.store.armTool(tool);
        return;
      },
    });

    // Arrows nudge the whole selection by 1 world px, 10 with Shift — one store.moveSelected per press,
    // so each press is one undo step (coalescing a held key into one step is deliberately not done).
    // Falls through when nothing is selected, so the board never eats arrows meant for someone else.
    this.shortcuts.register({
      layer: 'surface',
      keys: [
        'arrowleft',
        'arrowright',
        'arrowup',
        'arrowdown',
        'shift+arrowleft',
        'shift+arrowright',
        'shift+arrowup',
        'shift+arrowdown',
      ],
      when: idle,
      handler: (event) => {
        if (this.store.selectedIds().length === 0) return false;
        const direction = NUDGE_DIRECTION[event.key.toLowerCase()];
        if (!direction) return false;
        const step = event.shiftKey ? NUDGE_STEP_SHIFT : NUDGE_STEP;
        this.store.moveSelected({ x: direction.x * step, y: direction.y * step });
        return;
      },
    });
  }

  /** Track the gesture and its reactive mirror together — every gesture start funnels here. */
  private setGesture(gesture: Gesture): void {
    this.gesture = gesture;
    this._gestureActive.set(true);
  }

  /** Abandon the live gesture without committing or touching the selection; false if none was live. */
  private cancelGesture(): boolean {
    if (this.gesture === null) return false;
    this.clearGesture();
    return true;
  }

  private clearGesture(): void {
    this.gesture = null;
    this._gestureActive.set(false);
    this.moveDelta.set(null);
    this.resizePreview.set(null);
  }
}

/**
 * The new position/size a resize handle `dir` yields, given the element's `origin` geometry and the
 * world-space drag delta. The edge opposite each dragged edge stays fixed, and neither dimension shrinks
 * below {@link MIN_SIZE}. With `lockAspect` (width/height) the result holds that ratio — a corner and the
 * horizontal edges track the pointer's width and derive the height, a vertical edge tracks height and
 * derives width — then the dragged edges re-anchor against the corrected size. Pure — unit-testable
 * without a DOM.
 */
export function resizeGeometry(
  origin: { position: Point; size: Size },
  dir: Corner,
  worldDx: number,
  worldDy: number,
  lockAspect?: number,
): { position: Point; size: Size } {
  let { x } = origin.position;
  let { y } = origin.position;
  let { width, height } = origin.size;
  const right = origin.position.x + origin.size.width;
  const bottom = origin.position.y + origin.size.height;

  if (dir.includes('e')) width = Math.max(MIN_SIZE, origin.size.width + worldDx);
  if (dir.includes('w')) {
    x = Math.min(origin.position.x + worldDx, right - MIN_SIZE);
    width = right - x;
  }
  if (dir.includes('s')) height = Math.max(MIN_SIZE, origin.size.height + worldDy);
  if (dir.includes('n')) {
    y = Math.min(origin.position.y + worldDy, bottom - MIN_SIZE);
    height = bottom - y;
  }

  if (lockAspect && lockAspect > 0) {
    ({ width, height } = constrainToAspect(dir, width, height, lockAspect));
    // Re-anchor the dragged edges against the aspect-corrected size, so the opposite edge stays put.
    if (dir.includes('w')) x = right - width;
    if (dir.includes('n')) y = bottom - height;
  }
  return { position: { x, y }, size: { width, height } };
}

/**
 * Fold `width`/`height` onto the `aspect` (width/height): a vertical-only edge drives from height, every
 * other handle (corners and horizontal edges) drives from width. Whichever dimension would fall below
 * {@link MIN_SIZE} pins there and re-derives the other, so neither can undercut the floor.
 */
function constrainToAspect(dir: Corner, width: number, height: number, aspect: number): Size {
  const horizontal = dir.includes('e') || dir.includes('w');
  const vertical = dir.includes('n') || dir.includes('s');
  let w = width;
  let h = height;
  if (vertical && !horizontal) w = height * aspect;
  else h = width / aspect;
  if (w < MIN_SIZE) {
    w = MIN_SIZE;
    h = w / aspect;
  }
  if (h < MIN_SIZE) {
    h = MIN_SIZE;
    w = h * aspect;
  }
  return { width: w, height: h };
}
