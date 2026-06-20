import { Injectable, signal } from '@angular/core';
import {
  Axial,
  coordKey,
  emptyHexMap,
  FeatureId,
  HexMap,
  Region,
  TerrainId,
} from '@hexly/domain';
import { applyPatches, enablePatches, Patch, produceWithPatches } from 'immer';

// Immer only records patches once this is enabled; it underpins undo/redo.
enablePatches();

/**
 * What a canvas stroke does, as a tagged union so terrain, the eraser, and the
 * two Feature actions are siblings the store dispatches on (issue #7):
 *
 * - `terrain` — paint the built-in terrain `id` (creates or replaces a hex)
 * - `erase` — delete the hex record so the coordinate becomes Void
 * - `feature` — place the built-in feature `id` on an existing hex
 * - `clear-feature` — remove a hex's feature, leaving its terrain
 * - `region` — add the hovered hex to (or remove it from) region `id`, per `mode`
 */
export type Tool =
  | { readonly kind: 'terrain'; readonly id: TerrainId }
  | { readonly kind: 'erase' }
  | { readonly kind: 'feature'; readonly id: FeatureId }
  | { readonly kind: 'clear-feature' }
  | { readonly kind: 'region'; readonly id: string; readonly mode: 'add' | 'remove' };

/**
 * Whether a stroke keeps applying as the pointer drags across hexes. Terrain,
 * the eraser, and clear-feature are continuous brushes — sweeping them across a
 * drag is the intent and idempotent. Placing a Feature is a discrete stamp: a
 * drag must not mass-place duplicate features, so it applies only on the initial
 * press (issue #7).
 */
export function isContinuousTool(tool: Tool): boolean {
  return tool.kind !== 'feature';
}

/**
 * The editor's command/undo stack — the only "store" the editor needs (ADR-0005).
 * It holds the current {@link HexMap} as immutable state in a signal; every
 * mutation runs through Immer's `produceWithPatches`, and the inverse patches go
 * onto an undo stack so undo/redo come for free. Nothing mutates the document
 * directly — that discipline is what makes undo correct.
 */
@Injectable({ providedIn: 'root' })
export class EditorStore {
  private readonly _document = signal<HexMap>(emptyHexMap());
  /** The live document. Read-only to everyone but this store. */
  readonly document = this._document.asReadonly();

  /** The armed tool a canvas stroke applies — terrain, eraser, or a feature. */
  readonly tool = signal<Tool>({ kind: 'terrain', id: 'forest' });

  /** Committed edits, newest last — popped to undo, then parked on `redoStack`. */
  private readonly undoStack: Edit[] = [];
  private readonly redoStack: Edit[] = [];

  private readonly _canUndo = signal(false);
  private readonly _canRedo = signal(false);
  /** Whether there is an edit to undo / redo — drives the toolbar buttons. */
  readonly canUndo = this._canUndo.asReadonly();
  readonly canRedo = this._canRedo.asReadonly();

  /** Arm a {@link Tool} for the next strokes. */
  selectTool(tool: Tool): void {
    this.tool.set(tool);
  }

  /**
   * Adopt `document` as the map being edited — used when a map is opened from
   * the backend (issue #6). This is a fresh starting point, not an edit, so the
   * undo/redo history is cleared: you cannot undo back into the previous map.
   */
  load(document: HexMap): void {
    this._document.set(document);
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.syncHistory();
  }

  /** Apply the armed tool at `coord`, dispatching on its kind. */
  applyAt(coord: Axial): void {
    const tool = this.tool();
    switch (tool.kind) {
      case 'terrain':
        this.paintAt(coord, tool.id);
        break;
      case 'erase':
        this.eraseAt(coord);
        break;
      case 'feature':
        this.placeFeatureAt(coord, tool.id);
        break;
      case 'clear-feature':
        this.clearFeatureAt(coord);
        break;
      case 'region':
        if (tool.mode === 'add') this.addHexToRegion(tool.id, coord);
        else this.removeHexFromRegion(tool.id, coord);
        break;
    }
  }

  /**
   * Paint `terrain` onto the hex at `coord`, creating its record or replacing
   * only the terrain of an existing one. Terrain and Feature are independent
   * layers (CONTEXT.md), so a terrain stroke must not wipe a placed feature —
   * which matters because painting is a drag that sweeps across hexes.
   */
  paintAt(coord: Axial, terrain: TerrainId): void {
    this.commit((draft) => {
      const hex = draft.hexes[coordKey(coord)];
      if (hex) hex.terrain = terrain;
      else draft.hexes[coordKey(coord)] = { terrain };
    });
  }

  /**
   * Place (or replace) `feature` on the hex at `coord`. A Feature rides on an
   * existing Hex (CONTEXT.md), so placing on Void is a no-op — paint terrain
   * first. The recipe changing nothing means `commit` records no undo step.
   */
  placeFeatureAt(coord: Axial, feature: FeatureId): void {
    this.commit((draft) => {
      const hex = draft.hexes[coordKey(coord)];
      if (hex) hex.feature = { ref: feature };
    });
  }

  /**
   * Remove the feature from the hex at `coord`, leaving its terrain intact. A
   * hex with no feature, or a Void coordinate, is left untouched — `commit`
   * records no undo step when nothing changes.
   */
  clearFeatureAt(coord: Axial): void {
    this.commit((draft) => {
      delete draft.hexes[coordKey(coord)]?.feature;
    });
  }

  /** Erase the hex at `coord`, deleting its record so the coordinate is Void. */
  eraseAt(coord: Axial): void {
    this.commit((draft) => {
      delete draft.hexes[coordKey(coord)];
    });
  }

  /**
   * Create an empty Region with `name` and `color`, appended to the document,
   * and return its freshly-minted id. Membership starts empty — hexes are
   * painted in afterwards. Like every edit it goes through `commit`, so undo
   * removes the region (issue #8).
   */
  createRegion(name: string, color: string): string {
    const id = crypto.randomUUID();
    this.commit((draft) => {
      draft.regions.push({ id, name, color, hexes: {} });
    });
    return id;
  }

  /** Rename the region `id`; a no-op (no undo step) if there is no such region. */
  renameRegion(id: string, name: string): void {
    this.commit((draft) => {
      const region = findRegion(draft, id);
      if (region) region.name = name;
    });
  }

  /** Recolor the region `id`; a no-op if there is no such region. */
  recolorRegion(id: string, color: string): void {
    this.commit((draft) => {
      const region = findRegion(draft, id);
      if (region) region.color = color;
    });
  }

  /** Delete the region `id` entirely, along with its membership set. */
  deleteRegion(id: string): void {
    this.commit((draft) => {
      const at = draft.regions.findIndex((r) => r.id === id);
      if (at !== -1) draft.regions.splice(at, 1);
    });
  }

  /**
   * Add the hex at `coord` to region `id`. Membership is an independent set of
   * coordinates (a hex need not be painted, and a coordinate may belong to many
   * regions at once), so this only sets the key. Adding a coordinate already in
   * the region changes nothing, so `commit` records no undo step.
   */
  addHexToRegion(id: string, coord: Axial): void {
    this.commit((draft) => {
      const region = findRegion(draft, id);
      if (region) region.hexes[coordKey(coord)] = true;
    });
  }

  /** Remove the hex at `coord` from region `id`; a no-op if it was not a member. */
  removeHexFromRegion(id: string, coord: Axial): void {
    this.commit((draft) => {
      delete findRegion(draft, id)?.hexes[coordKey(coord)];
    });
  }

  /** Reverse the most recent edit. */
  undo(): void {
    const edit = this.undoStack.pop();
    if (!edit) return;
    this._document.set(applyPatches(this._document(), edit.undo));
    this.redoStack.push(edit);
    this.syncHistory();
  }

  /** Re-apply the most recently undone edit. */
  redo(): void {
    const edit = this.redoStack.pop();
    if (!edit) return;
    this._document.set(applyPatches(this._document(), edit.redo));
    this.undoStack.push(edit);
    this.syncHistory();
  }

  /**
   * Run `recipe` through Immer and adopt the result, recording the forward and
   * inverse patches so the edit can be undone and redone.
   */
  private commit(recipe: (draft: HexMap) => void): void {
    const [next, redo, undo] = produceWithPatches(this._document(), recipe);
    // No patches means the recipe changed nothing (e.g. erasing Void). Recording
    // it would leave empty undo steps and needlessly discard the redo branch.
    if (redo.length === 0) return;
    this._document.set(next);
    this.undoStack.push({ redo, undo });
    // A fresh edit forks history: the old redo branch can no longer be reached.
    this.redoStack.length = 0;
    this.syncHistory();
  }

  /** Mirror the stack depths into the reactive availability signals. */
  private syncHistory(): void {
    this._canUndo.set(this.undoStack.length > 0);
    this._canRedo.set(this.redoStack.length > 0);
  }
}

/** Find a region by id within a document draft (or `undefined`). */
function findRegion(doc: HexMap, id: string): Region | undefined {
  return doc.regions.find((r) => r.id === id);
}

/** A committed edit, as the forward and inverse Immer patches that effect it. */
interface Edit {
  readonly redo: Patch[];
  readonly undo: Patch[];
}
