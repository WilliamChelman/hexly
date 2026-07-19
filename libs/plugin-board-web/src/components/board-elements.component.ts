import { ChangeDetectionStrategy, Component, computed, HostListener, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ImageElement, Point, Size, stackingOrder, TextElement } from '@hexly/plugin-board';
import { BoardCamera } from '../services/board-camera';
import { BoardStore } from '../services/board-store';
import { DRAG_THRESHOLD } from '../utils/gesture';
import { BoardImageComponent } from './board-image.component';
import { TextBlockComponent } from './text-block.component';
import { toolForHotkey } from './tools';

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

/** One element resolved for the DOM: its screen-space box, its selection/armed state, and its content. */
interface Rendered {
  readonly id: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly selected: boolean;
  /** Whether this element is the armed one — its editor is live, so drag/resize is suppressed on it. */
  readonly armed: boolean;
  /** The Text Block element to render in place, or null for any other kind (Box, Image, Embed). */
  readonly text: TextElement | null;
  /** The Image element to render in place, or null for any other kind. */
  readonly image: ImageElement | null;
}

/** A live drag: moving the whole selection, or resizing one element from a handle. */
type Gesture =
  | { kind: 'move'; startX: number; startY: number; id: string; group: boolean; moved: boolean }
  | {
      kind: 'resize';
      startX: number;
      startY: number;
      id: string;
      dir: Corner;
      origin: { position: Point; size: Size };
    };

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
 */
@Component({
  selector: 'app-board-elements',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'absolute inset-0 pointer-events-none overflow-hidden' },
  imports: [TranslocoPipe, TextBlockComponent, BoardImageComponent],
  template: `
    @for (el of rendered(); track el.id) {
      <div
        class="element"
        [class.is-selected]="el.selected"
        [class.is-armed]="el.armed"
        [class.is-text]="!!el.text"
        [class.is-image]="!!el.image"
        [style.left.px]="el.left"
        [style.top.px]="el.top"
        [style.width.px]="el.width"
        [style.height.px]="el.height"
        [attr.data-testid]="'element-' + el.id"
        [attr.aria-label]="'board.canvas.element' | transloco"
        (pointerdown)="onElementDown(el.id, $event)"
        (dblclick)="onElementDblClick(el.id)"
      >
        @if (el.text; as text) {
          <app-board-text-block [element]="text" />
        }
        @if (el.image; as image) {
          <app-board-image [element]="image" />
        }
        @if (el.selected && single() && !el.armed) {
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
    }
  `,
  styles: `
    @reference '#app-styles.css';

    .element {
      @apply absolute pointer-events-auto rounded-sm cursor-move;
      background: color-mix(in srgb, var(--color-gold-soft) 55%, transparent);
      border: 1px solid var(--color-line-strong);
    }
    /* A Text Block reads as paper carrying prose, not a gold placeholder; armed, it invites a caret. */
    .element.is-text {
      @apply bg-surface-raised;
      border-color: var(--color-line);
    }
    /* An Image frames its own Asset — a quiet sunken mat behind the letterboxed picture, not gold. */
    .element.is-image {
      @apply bg-surface-sunken overflow-hidden;
      border-color: var(--color-line);
    }
    .element.is-armed {
      @apply cursor-text;
    }
    .element.is-selected {
      border-color: var(--color-gold);
      box-shadow: 0 0 0 1px var(--color-gold);
    }
    .handle {
      @apply absolute w-2 h-2 rounded-full pointer-events-auto;
      background: var(--color-gold);
      border: 1px solid var(--color-on-gilded, #fff);
    }
  `,
})
export class BoardElementsComponent {
  private readonly cam = inject(BoardCamera);
  private readonly store = inject(BoardStore);

  protected readonly handles = HANDLES;

  /** A live move offset in world pixels, applied to every selected element as a preview. */
  private readonly moveDelta = signal<Point | null>(null);
  /** A live resize preview for one element, in world coordinates. */
  private readonly resizePreview = signal<{ id: string; position: Point; size: Size } | null>(null);

  /** Whether exactly one element is selected — resize handles show only then (single-element geometry). */
  protected readonly single = computed(() => this.store.selectedElement() !== null);

  /** The active gesture; a plain field, not a signal — it gates the gesture, never the render. */
  private gesture: Gesture | null = null;

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
        width: size.width * camera.zoom,
        height: size.height * camera.zoom,
        selected: selected.has(el.id),
        armed: armed === el.id,
        text: el.kind === 'text' ? el : null,
        image: el.kind === 'image' ? el : null,
      };
    });
  });

  // ---- Element press: pick, then arm a move ---------------------------------

  protected onElementDown(id: string, event: PointerEvent): void {
    if (event.button !== 0) return;
    // An armed Text Block owns the pointer for typing and text selection: let the press reach its editor
    // and start no move gesture — dragging requires disarming first (CONTEXT.md → Text Block, #268).
    if (this.store.armed() === id) return;
    event.stopPropagation();
    (event.target as Element).setPointerCapture?.(event.pointerId);

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
    this.gesture = { kind: 'move', startX: event.clientX, startY: event.clientY, id, group, moved: false };
  }

  /**
   * Double-click **arms** an interactive element for inline editing (CONTEXT.md → Text Block, #268): a
   * plain click selects and can drag, a second click into it hands the pointer to its editor. Only the
   * Text Block arms today; other kinds have no edit mode, so the double-click is inert on them.
   */
  protected onElementDblClick(id: string): void {
    const element = this.store.document().elements.find((e) => e.id === id);
    if (element?.kind !== 'text') return;
    this.store.select(id, 'replace');
    this.store.arm(id);
  }

  // ---- Handle press: resize -------------------------------------------------

  protected onHandleDown(id: string, dir: Corner, event: PointerEvent): void {
    if (event.button !== 0) return;
    event.stopPropagation();
    (event.target as Element).setPointerCapture?.(event.pointerId);
    const element = this.store.document().elements.find((e) => e.id === id);
    if (!element) return;
    this.gesture = {
      kind: 'resize',
      startX: event.clientX,
      startY: event.clientY,
      id,
      dir,
      origin: { position: { ...element.position }, size: { ...element.size } },
    };
  }

  // ---- Global drag tracking -------------------------------------------------

  @HostListener('document:pointermove', ['$event'])
  protected onPointerMove(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture) return;
    const zoom = this.cam.camera().zoom;
    const worldDx = (event.clientX - gesture.startX) / zoom;
    const worldDy = (event.clientY - gesture.startY) / zoom;

    if (gesture.kind === 'move') {
      if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) >= DRAG_THRESHOLD) {
        gesture.moved = true;
      }
      if (gesture.moved) this.moveDelta.set({ x: worldDx, y: worldDy });
      return;
    }
    this.resizePreview.set({ id: gesture.id, ...resizeGeometry(gesture.origin, gesture.dir, worldDx, worldDy) });
  }

  @HostListener('document:pointerup', ['$event'])
  protected onPointerUp(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture) return;
    (event.target as Element).releasePointerCapture?.(event.pointerId);

    if (gesture.kind === 'move') {
      const delta = this.moveDelta();
      if (gesture.moved && delta) {
        this.store.moveSelected(delta);
      } else if (gesture.group) {
        // A plain click that never dragged collapses the set to the pressed element.
        this.store.select(gesture.id, 'replace');
      }
    } else {
      const preview = this.resizePreview();
      if (preview) this.store.setGeometry(gesture.id, preview.position, preview.size);
    }
    this.clearGesture();
  }

  @HostListener('document:pointercancel')
  protected onPointerCancel(): void {
    // Abandon the gesture without committing — a cancelled drag never lands at a stale destination.
    this.clearGesture();
  }

  // ---- Keyboard -------------------------------------------------------------

  /**
   * Delete/Backspace removes the selection, Escape clears it, `v`/`b` arm Tools, Cmd/Ctrl+Z undoes /
   * redoes. Suppressed while a text field is focused, so a keystroke meant for an input never leaks.
   */
  @HostListener('window:keydown', ['$event'])
  protected onKeydown(event: KeyboardEvent): void {
    if (isEditableTarget(event.target)) return;

    if (event.metaKey || event.ctrlKey) {
      if (event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) this.store.redo();
      else this.store.undo();
      return;
    }

    if (event.key === 'Escape') {
      this.store.deselect();
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.store.delete();
      return;
    }
    const tool = toolForHotkey(event.key);
    if (tool) this.store.armTool(tool);
  }

  private clearGesture(): void {
    this.gesture = null;
    this.moveDelta.set(null);
    this.resizePreview.set(null);
  }
}

/**
 * The new position/size a resize handle `dir` yields, given the element's `origin` geometry and the
 * world-space drag delta. The edge opposite each dragged edge stays fixed, and neither dimension shrinks
 * below {@link MIN_SIZE}. Pure — unit-testable without a DOM.
 */
export function resizeGeometry(
  origin: { position: Point; size: Size },
  dir: Corner,
  worldDx: number,
  worldDy: number,
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
  return { position: { x, y }, size: { width, height } };
}

/** Whether `target` is a text input the user is typing into — so shortcuts don't hijack its keys. */
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}
