import { InjectionToken, Signal } from '@angular/core';
import { EntityDetail, EntityDocument } from '@hexly/domain';
import { Patch } from '@hexly/immer';

/** Re-exported so a View lib (e.g. the Hex Map plugin) reads the undo/redo currency from one place. */
export type { Patch } from '@hexly/immer';

/**
 * A View that owns a *live* document — a TipTap editor with its own cursor and history — and commits
 * into the Entity Document on a debounce (ADR-0051), so between keystrokes it holds edits the
 * document lacks. It registers ({@link EntitySession.registerEditor}) so a save flushes those first
 * and dirty reflects them. A render-from-document View (the Hex Map) commits synchronously and never
 * registers.
 */
export interface LiveEditor {
  /** True while the editor holds edits not yet committed into the Entity Document. */
  readonly hasPendingCommit: Signal<boolean>;
  /** Commit the pending document into the Entity Document now — called before a save snapshot. */
  flushPendingCommit(): void;
}

/**
 * The central mutable store every View of the open Entity edits (ADR-0048, *Central
 * store* amendment). One Entity Document lives here; each View reads its slice off
 * {@link doc} and writes through {@link mutate}, the universal write-channel. `mutate`
 * returns Immer patches so a View that keeps its own undo/redo (the Hex Map editor)
 * can replay them through {@link applyPatches}.
 */
export interface EntitySession {
  /**
   * The open Entity's loaded detail, or `null` with none open — the Entity-level facts a View's chrome
   * needs (a References panel's `(id, seq)`, the declared type set). The working slice is {@link doc}.
   */
  readonly current: Signal<EntityDetail | null>;
  /** The working **Entity Document** (ADR-0051); a View reads its own slice (grid, prose, a Field). */
  readonly doc: Signal<EntityDocument>;
  /**
   * Run `recipe` against an Immer draft of the document, adopting the result and returning the
   * forward/inverse patches for a View that owns its undo/redo stack.
   */
  mutate(recipe: (draft: EntityDocument) => void): { redo: Patch[]; undo: Patch[] };
  /** Apply raw patches to the document — the undo/redo channel for a View replaying its own stack. */
  applyPatches(patches: Patch[]): void;
  /** Whether the caller may edit (ADR-0037); a View gates its editing affordances on it. */
  readonly writable: Signal<boolean>;
  /**
   * Bumps on a *fresh* load (a new Entity adopted, or the canvas cleared for a route
   * swap) — never on an edit. A View watches it to reset the transient state whose
   * meaning is tied to the old document (undo history, selection), which an edit must leave
   * intact.
   */
  readonly loadGeneration: Signal<number>;
  /**
   * Register a {@link LiveEditor} so a save flushes its pending edits into the document first and dirty
   * counts them (ADR-0051). Returns an unregister callback for teardown; a render-from-document View
   * need not register.
   */
  registerEditor(editor: LiveEditor): () => void;
}

/** DI token for the {@link EntitySession}; the composition root binds the concrete session to it. */
export const ENTITY_SESSION = new InjectionToken<EntitySession>('ENTITY_SESSION');
