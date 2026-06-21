import { computed, Injectable, signal } from '@angular/core';
import {
  Axial,
  coordKey,
  emptyHexMap,
  FeatureId,
  featureLibrary,
  HexMap,
  Label,
  Point,
  Region,
  TerrainId,
  terrainPalette,
} from '@hexly/domain';
import { applyPatches, enablePatches, Patch, produceWithPatches } from 'immer';

// Immer only records patches once this is enabled; it underpins undo/redo.
enablePatches();

/**
 * A top-level Tool armed in the palette (CONTEXT.md → Tool). Exactly one is
 * armed at a time, and a canvas gesture applies it. Tools that have variants
 * carry a current Subtool tracked separately ({@link FeatureSubtool},
 * {@link RegionSubtool}, and the terrain id). Issue #27 split the old flat
 * tagged union into this two-level model:
 *
 * - `select` — the non-destructive Tool; a click does nothing yet (issue #27)
 * - `terrain` — paint the remembered terrain (creates or replaces a hex)
 * - `feature` — place the remembered feature, or Clear it (see FeatureSubtool)
 * - `region` — add/remove the hovered hex to/from the remembered region
 * - `label` — drop a free-positioned Label at the clicked world point (issue #10)
 * - `erase` — delete the whole hex record so the coordinate becomes Void
 */
export type ToolId =
  | 'select'
  | 'terrain'
  | 'feature'
  | 'region'
  | 'label'
  | 'erase';

/**
 * The Feature tool's Subtool: a built-in library feature to place, or `'clear'`
 * to remove a hex's feature (leaving its terrain). Clear lives among the feature
 * Subtools because it is scoped to the feature layer (issue #27, ADR-0010).
 */
export type FeatureSubtool = FeatureId | 'clear';

/**
 * The Region tool's Subtool: which region the brush targets, and whether it
 * paints (`add`) or erases (`remove`) membership. `null` until a region is
 * picked — the Region tool then applies nothing.
 */
export interface RegionSubtool {
  readonly id: string;
  readonly mode: 'add' | 'remove';
}

/** The default world-pixel height a freshly-placed Label is drawn at (issue #10). */
export const DEFAULT_LABEL_SIZE = 28;

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

  /**
   * The armed top-level {@link ToolId} a canvas gesture applies. A map opens
   * armed with the non-destructive `select` so a stray first click never paints
   * (issue #27).
   */
  private readonly _tool = signal<ToolId>('select');
  readonly tool = this._tool.asReadonly();

  /**
   * Per-Tool Subtool memory — in-memory, session-only editor state in the same
   * category as the armed Tool itself: never part of the `HexMap` document,
   * never undone, saved, or restored across reloads (issue #27, ADR-0010).
   * Re-arming a Tool restores its remembered Subtool. Cold-start defaults:
   * Terrain → `forest`, Feature → the first library feature, Region → none.
   */
  private readonly _terrain = signal<TerrainId>('forest');
  private readonly _feature = signal<FeatureSubtool>(featureLibrary[0].id);
  private readonly _region = signal<RegionSubtool | null>(null);

  /** The remembered Terrain Subtool — the terrain a Terrain stroke paints. */
  readonly terrain = this._terrain.asReadonly();
  /** The remembered Feature Subtool — a library feature to place, or `'clear'`. */
  readonly feature = this._feature.asReadonly();
  /** The remembered Region Subtool — the targeted region and brush mode, or `null`. */
  readonly region = this._region.asReadonly();

  /**
   * Whether the armed Tool keeps applying as the pointer drags across hexes.
   * Terrain, Erase, Region, and the feature Clear Subtool are continuous brushes
   * — sweeping them is the intent and idempotent. Placing a Feature is a discrete
   * stamp (a drag must not mass-place duplicates, issue #7); Label is likewise a
   * discrete stamp (issue #10); Select paints nothing. (issue #27)
   */
  readonly continuous = computed<boolean>(() => {
    switch (this._tool()) {
      case 'terrain':
      case 'erase':
      case 'region':
        return true;
      case 'feature':
        return this._feature() === 'clear';
      default:
        return false;
    }
  });

  /**
   * The id of the Label currently selected for editing (or `null`). This is
   * transient editor state — not part of the document, so it is neither undone
   * nor persisted (issue #10). Read it through the {@link selectedLabel} computed,
   * which resolves it against the live document.
   */
  private readonly _selectedLabelId = signal<string | null>(null);

  /**
   * The currently-selected {@link Label} resolved from the live document, or
   * `null` when nothing is selected or the selected id no longer exists (e.g.
   * after an undo removed it). The inspector binds to this to edit the label.
   */
  readonly selectedLabel = computed<Label | null>(() => {
    const id = this._selectedLabelId();
    if (id === null) return null;
    return this._document().labels.find((l) => l.id === id) ?? null;
  });

  /** Committed edits, newest last — popped to undo, then parked on `redoStack`. */
  private readonly undoStack: Edit[] = [];
  private readonly redoStack: Edit[] = [];

  private readonly _canUndo = signal(false);
  private readonly _canRedo = signal(false);
  /** Whether there is an edit to undo / redo — drives the toolbar buttons. */
  readonly canUndo = this._canUndo.asReadonly();
  readonly canRedo = this._canRedo.asReadonly();

  /**
   * Arm the top-level Tool `id` for the next gestures. Re-arming a Tool restores
   * its remembered Subtool implicitly — the Subtool memory is held separately, so
   * switching Tools never disturbs it (issue #27).
   */
  armTool(id: ToolId): void {
    this._tool.set(id);
  }

  /** Arm the Terrain tool with terrain `id`, remembering it as the Terrain Subtool. */
  armTerrain(id: TerrainId): void {
    this._terrain.set(id);
    this._tool.set('terrain');
  }

  /**
   * Arm the Feature tool with `subtool` — a library feature to place, or `'clear'`
   * to remove a hex's feature — remembering it as the Feature Subtool.
   */
  armFeature(subtool: FeatureSubtool): void {
    this._feature.set(subtool);
    this._tool.set('feature');
  }

  /**
   * Arm the Region tool targeting region `id` in `mode`, remembering it as the
   * Region Subtool.
   */
  armRegion(id: string, mode: 'add' | 'remove'): void {
    this._region.set({ id, mode });
    this._tool.set('region');
  }

  /**
   * Pick the `n`-th (1-based) Subtool of the currently armed Tool — the keyboard
   * `1`–`9` binding (issue #27). The Subtool set is relative to the armed Tool:
   * Terrain → the terrain palette, Feature → the feature library then Clear,
   * Region → the document's regions (keeping the current brush mode). Out-of-range
   * indices and Tools without Subtools (Select, Label, Erase) are no-ops.
   */
  armSubtoolByIndex(n: number): void {
    switch (this._tool()) {
      case 'terrain': {
        const t = terrainPalette[n - 1];
        if (t) this.armTerrain(t.id);
        break;
      }
      case 'feature': {
        const subtools: FeatureSubtool[] = [
          ...featureLibrary.map((f) => f.id),
          'clear',
        ];
        const sub = subtools[n - 1];
        if (sub) this.armFeature(sub);
        break;
      }
      case 'region': {
        const r = this._document().regions[n - 1];
        if (r) this.armRegion(r.id, this._region()?.mode ?? 'add');
        break;
      }
      default:
        break;
    }
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
    // A freshly opened map arms the non-destructive Select tool so a stray click
    // never paints (issue #27). The Region Subtool referenced a region in the
    // previous document, so reset Subtool memory to the cold-start defaults
    // rather than leaving a dangling region id behind.
    this._tool.set('select');
    this._terrain.set('forest');
    this._feature.set(featureLibrary[0].id);
    this._region.set(null);
  }

  /** Apply the armed Tool (and its Subtool) at `coord`, dispatching on the Tool. */
  applyAt(coord: Axial): void {
    switch (this._tool()) {
      case 'select':
        // Select is non-destructive; its click behaviour is out of scope for
        // this slice — a click does nothing yet (issue #27, ADR-0010).
        break;
      case 'terrain':
        this.paintAt(coord, this._terrain());
        break;
      case 'erase':
        this.eraseAt(coord);
        break;
      case 'feature': {
        const subtool = this._feature();
        if (subtool === 'clear') this.clearFeatureAt(coord);
        else this.placeFeatureAt(coord, subtool);
        break;
      }
      case 'region': {
        const region = this._region();
        if (!region) break; // no region picked yet → nothing to apply
        if (region.mode === 'add') this.addHexToRegion(region.id, coord);
        else this.removeHexFromRegion(region.id, coord);
        break;
      }
      case 'label':
        // Labels are free-positioned at a world point, not a hex coordinate
        // (CONTEXT.md → Label), so the canvas places them via `addLabel` — there
        // is nothing to do on the hex-coordinate stroke path (issue #10).
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
    const id = mintId();
    this.commit((draft) => {
      draft.regions.push({ id, name, color, hexes: {} });
    });
    return id;
  }

  /** Rename the region `id`; a no-op (no undo step) if there is no such region. */
  renameRegion(id: string, name: string): void {
    this.updateRegion(id, (region) => {
      region.name = name;
    });
  }

  /** Recolor the region `id`; a no-op if there is no such region. */
  recolorRegion(id: string, color: string): void {
    this.updateRegion(id, (region) => {
      region.color = color;
    });
  }

  /** Delete the region `id` entirely, along with its membership set. */
  deleteRegion(id: string): void {
    this.commit((draft) => {
      const at = draft.regions.findIndex((r) => r.id === id);
      if (at !== -1) draft.regions.splice(at, 1);
    });
    // The Region Subtool now points at a region that no longer exists. Forget it,
    // and if the Region tool is armed, fall back to the non-destructive Select so
    // the canvas stays inert rather than silently no-opping every stroke.
    if (this._region()?.id === id) {
      this._region.set(null);
      if (this._tool() === 'region') this._tool.set('select');
    }
  }

  /**
   * Run `mutate` against the region `id` through `commit`; a no-op (no undo step)
   * if there is no such region. The shared find-and-guard for the per-field region
   * edits (rename, recolor).
   */
  private updateRegion(id: string, mutate: (region: Region) => void): void {
    this.commit((draft) => {
      const region = findRegion(draft, id);
      if (region) mutate(region);
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

  /** Select the Label `id` for editing in the inspector, or `null` to clear it. */
  selectLabel(id: string | null): void {
    this._selectedLabelId.set(id);
  }

  /**
   * Add a free-positioned Label with `text` anchored at world `position`, at the
   * default size, and return its freshly-minted id (issue #10). Like every edit
   * it goes through `commit`, so undo removes the label. The caller (the canvas)
   * typically selects the returned id so the inspector opens on it.
   */
  addLabel(text: string, position: Point): string {
    const id = mintId();
    this.commit((draft) => {
      draft.labels.push({ id, text, position: { x: position.x, y: position.y }, size: DEFAULT_LABEL_SIZE });
    });
    return id;
  }

  /** Replace the text of Label `id`; a no-op (no undo step) if there is no such label. */
  editLabelText(id: string, text: string): void {
    this.updateLabel(id, (label) => {
      label.text = text;
    });
  }

  /** Move Label `id` to world `position`; a no-op if there is no such label. */
  moveLabel(id: string, position: Point): void {
    this.updateLabel(id, (label) => {
      label.position = { x: position.x, y: position.y };
    });
  }

  /**
   * Resize Label `id` to `size` world pixels; a no-op if there is no such label.
   * The document's `size` must be a positive, finite number (`labelSchema.size`
   * is `z.number().positive()`), or the map fails save/load validation. The UI
   * can send `0` (a cleared field is `Number('') === 0`) or a negative, so the
   * store is the deep guard: a non-finite or non-positive `size` is a no-op and,
   * like every recipe that changes nothing, records no undo step (issue #10).
   */
  resizeLabel(id: string, size: number): void {
    if (!Number.isFinite(size) || size <= 0) return;
    this.updateLabel(id, (label) => {
      label.size = size;
    });
  }

  /** Rotate Label `id` to `rotation` degrees; a no-op if there is no such label. */
  rotateLabel(id: string, rotation: number): void {
    this.updateLabel(id, (label) => {
      label.rotation = rotation;
    });
  }

  /** Delete Label `id` entirely, clearing the selection if it pointed at it. */
  deleteLabel(id: string): void {
    this.commit((draft) => {
      const at = draft.labels.findIndex((l) => l.id === id);
      if (at !== -1) draft.labels.splice(at, 1);
    });
    if (this._selectedLabelId() === id) this._selectedLabelId.set(null);
  }

  /**
   * Run `mutate` against Label `id` through `commit`; a no-op (no undo step) if
   * there is no such label. The shared find-and-guard for the per-field label
   * edits (text, position, size, rotation).
   */
  private updateLabel(id: string, mutate: (label: Label) => void): void {
    this.commit((draft) => {
      const label = draft.labels.find((l) => l.id === id);
      if (label) mutate(label);
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

/** A unique id, preferring crypto.randomUUID but falling back where it is unavailable (insecure contexts). */
function mintId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'r-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/** A committed edit, as the forward and inverse Immer patches that effect it. */
interface Edit {
  readonly redo: Patch[];
  readonly undo: Patch[];
}
