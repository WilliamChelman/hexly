import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { Field, readField } from '@hexly/domain';
import {
  addElement,
  BoardElement,
  BoardSurface,
  boardSurfaceSchema,
  bringForward,
  bringToFront,
  emptyBoardSurface,
  Point,
  removeElement,
  sendBackward,
  sendToBack,
  Size,
  SURFACE_FIELD,
} from '@hexly/plugin-board';
import { Content, emptyContent } from '@hexly/plugin-content';
import { Patch } from '@hexly/immer';
import { ENTITY_SESSION, VIEW_FIELD_KEY } from '@hexly/web-entity';
import { BoardSelection } from './board-selection';
import type { SelectMode } from './board-selection';

// Re-exported so component callers reach the Selection vocabulary from the store.
export type { SelectMode } from './board-selection';

/**
 * A top-level Tool armed in the palette; exactly one armed, a canvas gesture applies it (CONTEXT.md →
 * Tool, #267). `select` is the non-destructive picker a Board opens on; `box` places the minimal static
 * element; `text` places a **Text Block** (#268); `image` places an **Image** displaying a World Asset
 * (#269) — its click opens a source chooser (upload / pick) before the element lands, so unlike Box/Text
 * the canvas does not place it synchronously.
 */
export type ToolId = 'select' | 'box' | 'text' | 'image';

/** The world-pixel size a freshly-placed Box is drawn at, before it is resized. */
export const DEFAULT_BOX_SIZE: Size = { width: 160, height: 120 };

/** The world-pixel size a freshly-placed Text Block is drawn at — a comfortable line's width to start typing. */
export const DEFAULT_TEXT_SIZE: Size = { width: 240, height: 120 };

/** The world-pixel size a freshly-placed Image is drawn at, before it is resized to frame its Asset. */
export const DEFAULT_IMAGE_SIZE: Size = { width: 240, height: 180 };

/**
 * The Board editor's store: tools, selection, and undo/redo over the surface. The document is the value
 * of a `core.board-surface` **Field of a Structured Data Type** (ADR-0050), at that Field's key in the
 * central {@link EntitySession}'s EntityDocument map. The free-positioned twin of `HexMapStore` (#263),
 * built the same way: reads project off `session.doc()`, edits go through `session.mutate` (Immer,
 * patches captured), and undo pushes those inverse patches back through `session.applyPatches`. Nothing
 * may mutate the document directly, or undo breaks.
 *
 * This ticket (#267, Seam B) grows the empty plane #266 stood up into the shared element-editing
 * pipeline: the surface-agnostic Tool / Selection / Inspector / z-order vocabulary, wrapping the pure
 * element helpers `@hexly/plugin-board` already ships, proven end-to-end with the minimal Box element.
 *
 * *Which* Field is {@link VIEW_FIELD_KEY}, provided by the entity page — one store drives one View over
 * its own slice of the body. Route-scoped (not `providedIn: 'root'`): it injects the route-scoped
 * {@link ENTITY_SESSION}, so it lives and dies with the open Entity.
 */
@Injectable()
export class BoardStore {
  private readonly session = inject(ENTITY_SESSION);

  /**
   * The Field this store's surface lives at — the surface data-type's Field, re-keyed to whichever
   * Field the active board View renders. Only the `id` (== the document key it lenses, ADR-0056) varies.
   *
   * Required, with no default: falling back to `core.surface` would make a mis-wired host edit the
   * wrong document rather than fail.
   */
  private readonly field: Field = { ...SURFACE_FIELD, id: inject(VIEW_FIELD_KEY) };

  /**
   * Surfaces this store produced, by reference — well-formed by construction, so {@link surface} takes
   * them as-is. Without this, every commit would re-parse the whole document. Immer mints a new object
   * per edit, so a surface written by anything else (a load, a peer View) is absent from the set and
   * gets parsed.
   */
  private readonly minted = new WeakSet<object>();

  /**
   * The surface to render, and whether the stored value already *is* that surface.
   *
   * A Field's value is validated forward-only (CONTEXT.md → Field), so this is the one place that
   * checks it. A value that does not parse opens as an empty plane rather than erroring, and the first
   * {@link commit} replaces it — so does one whose parse only succeeded by *filling* `elements`: a
   * recipe cannot push onto an array the document does not carry.
   */
  private readonly surface = computed<{ surface: BoardSurface; stored: boolean }>(() => {
    const raw = readField(this.session.doc(), this.field);
    if (isObject(raw) && this.minted.has(raw)) return { surface: raw as BoardSurface, stored: true };
    const parsed = boardSurfaceSchema.safeParse(raw);
    if (!parsed.success) return { surface: emptyBoardSurface(), stored: false };
    const complete = Array.isArray((raw as BoardSurface).elements);
    return { surface: parsed.data, stored: complete };
  });

  /** The live document — the Entity's surface. Read-only: the store writes through {@link commit}, never here. */
  readonly document = computed<BoardSurface>(() => this.surface().surface);

  /** The transient Selection: owns the id set, resolved against the live document. */
  private readonly sel = new BoardSelection(this.document);

  /** Selection state, delegated to {@link BoardSelection}; re-exposed so callers read it from one place. */
  readonly selectedIds = this.sel.selectedIds;
  readonly selectedElements = this.sel.selectedElements;
  readonly selectedElement = this.sel.selectedElement;

  /**
   * The armed {@link ToolId} a canvas gesture applies. Opens on the non-destructive `select` so a stray
   * first gesture never places an element (CONTEXT.md → Tool).
   */
  private readonly _tool = signal<ToolId>('select');
  readonly tool = this._tool.asReadonly();

  /**
   * The single **armed** element — an element put into its active/editable state (a Text Block being
   * edited inline, later). At most one at a time, mirroring the single armed Tool. Transient UI state:
   * never in the document, never undone or persisted. The minimal Box has no edit mode of its own, so
   * arming it is inert beyond the machinery this proves.
   */
  private readonly _armed = signal<string | null>(null);
  /**
   * The armed element id, resolved against the live surface — an element that is gone (deleted, or
   * dropped by an undo) resolves away, symmetric with {@link selectedIds}, so the armed id can never
   * dangle off an element that no longer exists.
   */
  readonly armed = computed<string | null>(() => {
    const id = this._armed();
    if (id === null) return null;
    return this.document().elements.some((e) => e.id === id) ? id : null;
  });

  /** Committed edits, newest last — popped to undo, then parked on `redoStack`. */
  private readonly undoStack: Edit[] = [];
  private readonly redoStack: Edit[] = [];

  private readonly _canUndo = signal(false);
  private readonly _canRedo = signal(false);
  /** Whether there is an edit to undo / redo — drives the toolbar buttons. */
  readonly canUndo = this._canUndo.asReadonly();
  readonly canRedo = this._canRedo.asReadonly();

  constructor() {
    // Reset on a *fresh* load, not on our own edits (ADR-0048): the session bumps loadGeneration only
    // when a new Entity is adopted or the canvas is cleared for a route swap. Undo patches and selection
    // ids are tied to the old body — undoing after a load would corrupt the new surface. Gated on a
    // *change* in the counter, so the reset tracks a real load, not merely an effect flush.
    let seenGeneration = this.session.loadGeneration();
    effect(() => {
      const generation = this.session.loadGeneration();
      if (generation === seenGeneration) return;
      seenGeneration = generation;
      this.resetForLoad();
    });
  }

  // ---- Tool arming ---------------------------------------------------------

  /** Arm the Tool `id`; a canvas gesture then applies it. */
  armTool(id: ToolId): void {
    this._tool.set(id);
  }

  // ---- Element arming (transient, non-persisted) ---------------------------

  /**
   * Arm element `id` — its active/editable state — replacing whatever was armed, so at most one is ever
   * armed (mirroring the single armed Tool). A no-op arg of a non-existent id is still recorded: the
   * canvas only ever passes a live id, and the resolved-away armed getter can guard the render.
   */
  arm(id: string): void {
    this._armed.set(id);
  }

  /** Disarm the armed element, if any. */
  disarm(): void {
    this._armed.set(null);
  }

  // ---- Selection -----------------------------------------------------------

  /** Select element `id` per `mode` (plain replace / Cmd-toggle / Shift-add); disarms a foreign armed element. */
  select(id: string, mode: SelectMode = 'replace'): void {
    this.sel.select(id, mode);
    this.disarmIfUnselected();
  }

  /** Replace or (when `additive`) extend the selection with `ids` — the marquee/programmatic path. */
  selectMany(ids: readonly string[], additive = false): void {
    this.sel.selectMany(ids, additive);
    this.disarmIfUnselected();
  }

  /** Clear the selection (Escape, a click on empty surface); disarms too. */
  deselect(): void {
    this.sel.deselect();
    this.disarm();
  }

  // ---- Element operations --------------------------------------------------

  /**
   * Add the minimal Box element at world `position`, on top of the stack (CONTEXT.md → Board Element;
   * user story 21), selecting it. The store mints the id and stamps `z` above the current top, so a
   * freshly placed element is never hidden. Returns the new id.
   */
  addElement(position: Point): string {
    const id = mintId();
    this.place({ id, kind: 'box', position: { x: position.x, y: position.y }, size: { ...DEFAULT_BOX_SIZE }, z: 0 });
    return id;
  }

  /**
   * Add a **Text Block** at world `position` — an empty `core.rich-content` value edited with the same
   * editor as an Entity's Content (CONTEXT.md → Text Block, #268). Placed on top and selected like any
   * element, then **armed** so the author writes in it at once: the Text Block is the first inline-edit
   * consumer of the arm/disarm machinery #267 stood up. Returns the new id.
   */
  addText(position: Point): string {
    const id = mintId();
    this.place({
      id,
      kind: 'text',
      position: { x: position.x, y: position.y },
      size: { ...DEFAULT_TEXT_SIZE },
      z: 0,
      content: emptyContent(),
    });
    this.arm(id);
    return id;
  }

  /**
   * Add an **Image** at world `position` displaying the World Asset at `assetUrl` (CONTEXT.md → Image,
   * #269). Placed on top and selected like any element, but **never armed**: an Image has no edit mode,
   * so a click only ever selects/moves it. `assetUrl` is the served capability URL the caller obtained by
   * uploading a file or picking an existing Asset — the store takes it as-is; both sources funnel here.
   * Returns the new id.
   */
  addImage(position: Point, assetUrl: string): string {
    const id = mintId();
    this.place({
      id,
      kind: 'image',
      position: { x: position.x, y: position.y },
      size: { ...DEFAULT_IMAGE_SIZE },
      z: 0,
      assetUrl,
    });
    return id;
  }

  /**
   * Replace a **Text Block**'s prose with `content` (the inline editor's committed doc, #268), as one
   * undoable step. A no-op — no undo step — for a missing id or a non-text element, so a stray call from
   * a mis-wired host never corrupts a Box or Image.
   */
  setContent(id: string, content: Content): void {
    this.commit((surface) => {
      const element = surface.elements.find((e) => e.id === id);
      if (element?.kind === 'text') element.content = content;
    });
  }

  /**
   * Place `element` on top of the stack via the pure {@link addElement} helper, selecting it so the
   * Inspector opens on it. The `z` on `element` is a placeholder the helper overwrites. Compute the next
   * surface from the committed (plain) document, then overwrite the draft wholesale — never read the
   * Immer draft into a pure helper, which would splice draft proxies into a new array.
   */
  private place(element: BoardElement): void {
    const next = addElement(this.document(), element);
    const committed = this.commit((surface) => replaceSurface(surface, next));
    // Stamp the selection so undo drops the element and its selection together.
    this.sel.select(element.id, 'replace');
    if (committed) this.trackSelectionOnLastEdit();
  }

  /** Move element `id` to world `position`; a no-op (no undo step) if there is no such element. */
  move(id: string, position: Point): void {
    this.commit((surface) => {
      const element = surface.elements.find((e) => e.id === id);
      if (element) element.position = { x: position.x, y: position.y };
    });
  }

  /**
   * Resize element `id` to `size` world pixels; a no-op if no such element. Both dimensions must be
   * positive and finite (`sizeSchema` requires positive) or save/load fails; the Inspector can send `0`
   * or a negative, so the store is the deep guard.
   */
  resize(id: string, size: Size): void {
    if (!isPositiveSize(size)) return;
    this.commit((surface) => {
      const element = surface.elements.find((e) => e.id === id);
      if (element) element.size = { width: size.width, height: size.height };
    });
  }

  /**
   * Set element `id`'s position and size together in one {@link commit} — the resize-drag path, where
   * dragging a top/left handle both moves and resizes. One undo step; a no-op if no such element, or the
   * size is non-positive.
   */
  setGeometry(id: string, position: Point, size: Size): void {
    if (!isPositiveSize(size)) return;
    this.commit((surface) => {
      const element = surface.elements.find((e) => e.id === id);
      if (element) {
        element.position = { x: position.x, y: position.y };
        element.size = { width: size.width, height: size.height };
      }
    });
  }

  /**
   * Move the whole live Selection by world `delta` — the unified move every drag routes through. One
   * {@link commit}, so a drag is one undo step however much is selected. The selection is by id, so it
   * rides the move for free (the elements keep their ids). Returns whether a step was recorded.
   */
  moveSelected(delta: Point): boolean {
    if (delta.x === 0 && delta.y === 0) return false;
    const ids = new Set(this.sel.selectedIds());
    if (ids.size === 0) return false;
    const committed = this.commit((surface) => {
      for (const element of surface.elements) {
        if (ids.has(element.id)) {
          element.position = { x: element.position.x + delta.x, y: element.position.y + delta.y };
        }
      }
    });
    if (committed) this.trackSelectionOnLastEdit();
    return committed;
  }

  /**
   * Delete the whole Selection set in one {@link commit}, so the deletion is one undo step. Resolved
   * against the live document first, so stale ids delete nothing. Clears the selection and stamps it so
   * undo restores the elements and the selection together.
   */
  delete(): void {
    const ids = this.sel.selectedIds();
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const next = this.document().elements.filter((e) => !idSet.has(e.id));
    const committed = this.commit((surface) => {
      surface.elements = next;
    });
    // Disarm an armed element caught in the deletion; session-only, deliberately out of the undoable edit.
    if (this._armed() && idSet.has(this._armed() as string)) this.disarm();
    this.sel.deselect();
    if (committed) this.trackSelectionOnLastEdit();
  }

  /** Delete a single element `id` regardless of selection; drops it from the selection if it was in it. */
  deleteElement(id: string): void {
    const next = removeElement(this.document(), id);
    const committed = this.commit((surface) => replaceSurface(surface, next));
    this.sel.dropWhere((selected) => selected === id);
    if (this._armed() === id) this.disarm();
    if (committed) this.trackSelectionOnLastEdit();
  }

  // ---- z-order (pure reorderings from #265's helpers) ----------------------

  /** Bring element `id` one step up the stack. */
  bringForward(id: string): void {
    this.reorder((surface) => bringForward(surface, id));
  }

  /** Send element `id` one step down the stack. */
  sendBackward(id: string): void {
    this.reorder((surface) => sendBackward(surface, id));
  }

  /** Move element `id` to the very top of the stack. */
  toFront(id: string): void {
    this.reorder((surface) => bringToFront(surface, id));
  }

  /** Move element `id` to the very bottom of the stack. */
  toBack(id: string): void {
    this.reorder((surface) => sendToBack(surface, id));
  }

  /** Run a pure z-order helper through {@link commit}; the helpers no-op (no undo step) on an unknown id. */
  private reorder(fn: (surface: BoardSurface) => BoardSurface): void {
    const next = fn(this.document());
    this.commit((surface) => replaceSurface(surface, next));
  }

  // ---- Commit / history ----------------------------------------------------

  /**
   * Run `recipe` through the session's {@link ENTITY_SESSION.mutate}, recording the returned patches
   * for undo/redo. Returns whether a step was recorded — callers that re-point the selection use it to
   * know an edit exists to {@link trackSelectionOnLastEdit stamp}. A recipe that changes nothing records
   * nothing.
   *
   * An unstored surface (absent, or garbage the editor is showing as an empty plane) is *replaced* by
   * the plane on screen, inside the same mutation as the edit that provoked it: the recipe always writes
   * to a well-formed surface, and the repair is one undoable step with its edit.
   */
  commit(recipe: (draft: BoardSurface) => void): boolean {
    const selectionBefore = this.sel.snapshot();
    const { surface, stored } = this.surface();
    const { redo, undo } = this.session.mutate((body) => {
      // The body IS the EntityDocument map (ADR-0051), so the surface sits at its own key on the draft.
      if (stored) {
        recipe(body[this.field.id] as BoardSurface);
        return;
      }
      // Cloned first: an assigned value is not a draft, so a recipe run over `surface` would mutate the
      // object {@link surface} is still holding.
      const fresh = structuredClone(surface);
      recipe(fresh);
      body[this.field.id] = fresh;
    });
    // No patches → the recipe changed nothing; recording it would leave empty undo steps and discard
    // the redo branch.
    if (redo.length === 0) return false;
    this.rememberMintedSurface();
    // selectionAfter defaults to before; re-pointing edits update it via trackSelectionOnLastEdit.
    this.undoStack.push({ redo, undo, selectionBefore, selectionAfter: selectionBefore });
    // A fresh edit forks history: the old redo branch is unreachable.
    this.redoStack.length = 0;
    this.syncHistory();
    return true;
  }

  /** Reverse the most recent edit, restoring the selection it was made under. */
  undo(): void {
    const edit = this.undoStack.pop();
    if (!edit) return;
    // Replay the inverse patches through the session — it owns the body, so the surface slice this store
    // reads updates in lockstep (ADR-0048).
    this.session.applyPatches(edit.undo);
    this.sel.restore(edit.selectionBefore);
    this.redoStack.push(edit);
    this.syncHistory();
  }

  /** Re-apply the most recently undone edit, restoring its resulting selection. */
  redo(): void {
    const edit = this.redoStack.pop();
    if (!edit) return;
    this.session.applyPatches(edit.redo);
    this.sel.restore(edit.selectionAfter);
    this.undoStack.push(edit);
    this.syncHistory();
  }

  /**
   * Reset the transient editor state a fresh load invalidates: the undo/redo history (its patches target
   * the old body), the selection, the armed element, and the armed Tool. The document itself is derived
   * from the session's body, so there is no surface to set here.
   */
  private resetForLoad(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.syncHistory();
    this._tool.set('select');
    this.sel.deselect();
    this.disarm();
  }

  /**
   * Claim the surface a {@link commit} just produced: its recipe ran on a valid plane, so the output is
   * well-formed. Never called for an undo/redo replay — that can restore a surface which was malformed
   * at rest, and claiming it would hand the renderer exactly what the parse exists to catch.
   */
  private rememberMintedSurface(): void {
    const raw = readField(this.session.doc(), this.field);
    if (isObject(raw)) this.minted.add(raw);
  }

  /**
   * Stamp the current selection onto the most recent edit as its `selectionAfter` so redo restores it.
   * Called by edits that add, move, or delete elements and re-point the selection.
   */
  private trackSelectionOnLastEdit(): void {
    const edit = this.undoStack[this.undoStack.length - 1];
    if (edit) edit.selectionAfter = this.sel.snapshot();
  }

  /** Disarm the armed element if it is no longer in the selection, so arming never dangles off a pick. */
  private disarmIfUnselected(): void {
    const armed = this._armed();
    if (armed !== null && !this.sel.has(armed)) this.disarm();
  }

  /** Mirror the stack depths into the reactive availability signals. */
  private syncHistory(): void {
    this._canUndo.set(this.undoStack.length > 0);
    this._canRedo.set(this.redoStack.length > 0);
  }
}

/** A non-null object — the only thing a surface value can be, and what a `WeakSet` can hold. */
function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

/** Whether both dimensions are positive and finite — the guard `sizeSchema` enforces at rest. */
function isPositiveSize(size: Size): boolean {
  return Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0;
}

/**
 * Overwrite `draft`'s contents in place from a pure helper's `next` surface. The element helpers return
 * a fresh surface; a commit recipe mutates the Immer draft, so this copies the result across so patches
 * are captured. The array is replaced (not spliced) — Immer diffs it either way.
 */
function replaceSurface(draft: BoardSurface, next: BoardSurface): void {
  draft.elements = next.elements;
}

/**
 * A unique id for an element. `crypto.randomUUID` is secure-context-only — undefined over plain HTTP on
 * a LAN, the intended self-hosted deployment — so the fallback covers that (internal ids: collision
 * resistance is all that matters).
 */
function mintId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'e-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/** A committed edit, as the forward and inverse Immer patches that effect it, plus its selection frame. */
interface Edit {
  readonly redo: Patch[];
  readonly undo: Patch[];
  /** The selection just before this edit — restored on undo so it tracks the document. */
  readonly selectionBefore: readonly string[];
  /** The selection just after this edit (and any post-commit re-point) — restored on redo. */
  selectionAfter: readonly string[];
}
