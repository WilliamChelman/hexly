import { InjectionToken, Signal } from '@angular/core';
import { EntityBody } from '@hexly/domain';
import { Patch } from '@hexly/immer';

/** Re-exported so a View lib (e.g. the Hex Map plugin) reads the undo/redo currency from one place. */
export type { Patch } from '@hexly/immer';

/**
 * The central mutable store every View of the open Entity edits (ADR-0048, *Central
 * store* amendment). One Entity body lives here; each View reads its slice off
 * {@link body} and writes through {@link mutate}, the universal write-channel. `mutate`
 * returns Immer patches so a View that keeps its own undo/redo (the Hex Map editor)
 * can replay them through {@link applyPatches}.
 */
export interface EntitySession {
  /** The working Entity body; a View reads its own slice (grid now, Fields/Metadata later). */
  readonly body: Signal<EntityBody>;
  /**
   * Run `recipe` against an Immer draft of the body, adopting the result and returning the
   * forward/inverse patches for a View that owns its undo/redo stack.
   */
  mutate(recipe: (draft: EntityBody) => void): { redo: Patch[]; undo: Patch[] };
  /** Apply raw patches to the body — the undo/redo channel for a View replaying its own stack. */
  applyPatches(patches: Patch[]): void;
  /** Whether the caller may edit (ADR-0037); a View gates its editing affordances on it. */
  readonly writable: Signal<boolean>;
  /**
   * Bumps on a *fresh* load (a new Entity adopted, or the canvas cleared for a route
   * swap) — never on an edit. A View watches it to reset the transient state whose
   * meaning is tied to the old body (undo history, selection), which an edit must leave
   * intact.
   */
  readonly loadGeneration: Signal<number>;
}

/** DI token for the {@link EntitySession}; the composition root binds the concrete session to it. */
export const ENTITY_SESSION = new InjectionToken<EntitySession>('ENTITY_SESSION');
