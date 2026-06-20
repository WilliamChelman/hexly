import { Injectable, signal } from '@angular/core';
import {
  Axial,
  coordKey,
  emptyHexMap,
  HexMap,
  terrainPalette,
  TerrainId,
} from '@hexly/domain';
import { applyPatches, enablePatches, Patch, produceWithPatches } from 'immer';

// Immer only records patches once this is enabled; it underpins undo/redo.
enablePatches();

/** The eraser pseudo-tool: a stroke that deletes hex records (CONTEXT.md → Void). */
export const ERASER = 'erase';

/** What a stroke does: lay down one of the built-in terrains, or erase. */
export type Tool = TerrainId | typeof ERASER;

const TERRAIN_IDS = new Set<string>(terrainPalette.map((t) => t.id));

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

  /** The armed tool a canvas stroke applies — a terrain or the eraser. */
  readonly tool = signal<Tool>('forest');

  /** Committed edits, newest last — popped to undo, then parked on `redoStack`. */
  private readonly undoStack: Edit[] = [];
  private readonly redoStack: Edit[] = [];

  private readonly _canUndo = signal(false);
  private readonly _canRedo = signal(false);
  /** Whether there is an edit to undo / redo — drives the toolbar buttons. */
  readonly canUndo = this._canUndo.asReadonly();
  readonly canRedo = this._canRedo.asReadonly();

  /** Arm a tool (a terrain id or {@link ERASER}) for the next strokes. */
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

  /** Apply the armed tool at `coord`: erase if the eraser is armed, else paint. */
  applyAt(coord: Axial): void {
    const tool = this.tool();
    if (tool === ERASER) this.eraseAt(coord);
    else if (TERRAIN_IDS.has(tool)) this.paintAt(coord, tool);
  }

  /** Paint `terrain` onto the hex at `coord`, creating or replacing its record. */
  paintAt(coord: Axial, terrain: TerrainId): void {
    this.commit((draft) => {
      draft.hexes[coordKey(coord)] = { terrain };
    });
  }

  /** Erase the hex at `coord`, deleting its record so the coordinate is Void. */
  eraseAt(coord: Axial): void {
    this.commit((draft) => {
      delete draft.hexes[coordKey(coord)];
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

/** A committed edit, as the forward and inverse Immer patches that effect it. */
interface Edit {
  readonly redo: Patch[];
  readonly undo: Patch[];
}
