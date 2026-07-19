import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { Field, readField } from '@hexly/domain';
import { BoardSurface, boardSurfaceSchema, emptyBoardSurface, SURFACE_FIELD } from '@hexly/plugin-board';
import { Patch } from '@hexly/immer';
import { ENTITY_SESSION, VIEW_FIELD_KEY } from '@hexly/web-entity';

/**
 * The Board editor's store: holds the Board Surface document and commits edits to it through the
 * central {@link EntitySession}. The free-positioned twin of `HexMapStore` (ADR-0050, #263), built the
 * same way — the document is the value of a `core.board-surface` **Field of a Structured Data Type**,
 * at that Field's key in the session's EntityDocument map. Reads project off `session.doc()`, edits go
 * through `session.mutate` (Immer, patches captured), and undo pushes those inverse patches back
 * through `session.applyPatches`. Nothing may mutate the document directly, or undo breaks.
 *
 * This ticket (#266) stands the surface up as an empty, navigable plane: the store holds and commits
 * the document, but affords no element operations yet — those (add/move/resize/reorder) layer onto the
 * {@link commit} seam in a later ticket, wrapping the pure helpers `@hexly/plugin-board` already ships.
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
    // when a new Entity is adopted or the canvas is cleared for a route swap. Undo patches are tied to
    // the old body — undoing after a load would corrupt the new surface. Gated on a *change* in the
    // counter, so the reset tracks a real load, not merely an effect flush.
    let seenGeneration = this.session.loadGeneration();
    effect(() => {
      const generation = this.session.loadGeneration();
      if (generation === seenGeneration) return;
      seenGeneration = generation;
      this.resetForLoad();
    });
  }

  /**
   * Run `recipe` through the session's {@link ENTITY_SESSION.mutate}, recording the returned patches
   * for undo/redo. The commit primitive every element operation will wrap; exposed now so the empty
   * surface can be driven and committed against while the semantic operations are still to come.
   * Returns whether a step was recorded — a recipe that changes nothing records nothing.
   *
   * An unstored surface (absent, or garbage the editor is showing as an empty plane) is *replaced* by
   * the plane on screen, inside the same mutation as the edit that provoked it: the recipe always
   * writes to a well-formed surface, and the repair is one undoable step with its edit.
   */
  commit(recipe: (draft: BoardSurface) => void): boolean {
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
    this.undoStack.push({ redo, undo });
    // A fresh edit forks history: the old redo branch is unreachable.
    this.redoStack.length = 0;
    this.syncHistory();
    return true;
  }

  /** Reverse the most recent edit. */
  undo(): void {
    const edit = this.undoStack.pop();
    if (!edit) return;
    // Replay the inverse patches through the session — it owns the body, so the surface slice this
    // store reads updates in lockstep (ADR-0048).
    this.session.applyPatches(edit.undo);
    this.redoStack.push(edit);
    this.syncHistory();
  }

  /** Re-apply the most recently undone edit. */
  redo(): void {
    const edit = this.redoStack.pop();
    if (!edit) return;
    this.session.applyPatches(edit.redo);
    this.undoStack.push(edit);
    this.syncHistory();
  }

  /**
   * Reset the transient editor state a fresh load invalidates: the undo/redo history, whose patches
   * target the old body. The document itself is derived from the session's body, so there is no
   * surface to set here.
   */
  private resetForLoad(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.syncHistory();
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

/** A committed edit, as the forward and inverse Immer patches that effect it. */
interface Edit {
  readonly redo: Patch[];
  readonly undo: Patch[];
}
