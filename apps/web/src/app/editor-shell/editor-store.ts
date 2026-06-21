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
  regionById,
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

/**
 * The single selected entity, or `null` when nothing is selected. Select is the
 * one selection path (CONTEXT.md → Select, ADR-0010/0011): it references a Label
 * or a Region by id, or a Feature / Hex by the coordinate it sits on. At most one
 * is selected at a time. The store resolves a click's geometric inputs into one
 * of these by walking a per-coordinate stack — `Label → Feature → Hex → each
 * containing Region (document order)` — see {@link EditorStore.select}.
 */
export type Selection =
  | { readonly kind: 'label'; readonly id: string }
  | { readonly kind: 'feature'; readonly coord: Axial }
  | { readonly kind: 'hex'; readonly coord: Axial }
  | { readonly kind: 'region'; readonly id: string };

/**
 * The internal selection reference the store actually stores: a Label or a Region
 * by id, or a map cell by coordinate. Whether a cell reads as a Feature or a bare
 * Hex is *derived* from the live document (see {@link EditorStore.selection}), as
 * is whether a referenced Region still exists — so the selection self-heals when
 * the document changes under it (a feature placed/cleared, the hex erased, the
 * region deleted, an undo) rather than going stale (issues #28, #35).
 */
type SelectionRef =
  | { readonly kind: 'label'; readonly id: string }
  | { readonly kind: 'cell'; readonly coord: Axial }
  | { readonly kind: 'region'; readonly id: string };

/**
 * The Feature Tool's Subtools in palette/keyboard order: each library feature,
 * then the Clear Subtool last. The single source of truth for the index→Subtool
 * mapping the keyboard ({@link EditorStore.armSubtoolByIndex}) and the palette
 * keycaps share, so the two cannot drift (issue #27, ADR-0010).
 */
export const featureSubtools: readonly FeatureSubtool[] = [
  ...featureLibrary.map((f) => f.id),
  'clear',
];

/** Cold-start Subtool defaults — the state a fresh map and a reloaded map share. */
const DEFAULT_TERRAIN: TerrainId = 'forest';
const DEFAULT_FEATURE: FeatureSubtool = featureLibrary[0].id;

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
  private readonly _terrain = signal<TerrainId>(DEFAULT_TERRAIN);
  private readonly _feature = signal<FeatureSubtool>(DEFAULT_FEATURE);
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
   * The selection reference (or `null`). Transient editor state — not part of the
   * document, so it is neither undone nor persisted (issues #10, #28). This holds
   * only the reference (a label id, or a cell coordinate); the live {@link kind}
   * and existence are resolved from the document by {@link selection}.
   */
  private readonly _selection = signal<SelectionRef | null>(null);

  /**
   * The anchor of the per-coordinate selection cycle (CONTEXT.md → Select,
   * ADR-0011): the `coordKey|labelHit` of the click the cycle is running at, or
   * `null` when no cycle is in progress. A click resolves a stack of candidates
   * at one coordinate — `Label → Feature → Hex → each containing Region in
   * document order` — and *repeated* clicks at the same anchor descend through it,
   * wrapping after the last; a click on a different coordinate or label fails to
   * match and resets to the top.
   *
   * Only the anchor is stored — never an index. The descent position is *derived*
   * each click from where the live {@link _selection} sits in the freshly-resolved
   * stack (see {@link select}), so it can't go stale: any path that changes the
   * selection out from under the cycle (a label drop, a Hex move, an undo, a
   * document edit that adds/removes a candidate) is absorbed rather than leaving a
   * dangling integer that mis-targets the next click (issues #28, #35). Transient
   * editor state — never in the document, undone, or persisted.
   */
  private cycleAnchor: string | null = null;

  /**
   * What is currently selected, or `null`, resolved against the live document so
   * it never goes stale: a cell with a Feature reads as `feature`, a cell with a
   * bare Hex as `hex`, and a cell whose hex was erased (or a label whose id is
   * gone) resolves to `null`. The inspector and renderer read this to show and
   * highlight the selection; the canvas hands a click's geometric inputs to
   * {@link select}, which sets the reference under the precedence rule (issue #28).
   */
  readonly selection = computed<Selection | null>(() => {
    const ref = this._selection();
    if (!ref) return null;
    if (ref.kind === 'label') {
      return this._document().labels.some((l) => l.id === ref.id)
        ? { kind: 'label', id: ref.id }
        : null;
    }
    if (ref.kind === 'region') {
      // A Region selection self-heals: once its region is gone (deleted, undone),
      // the selection resolves to nothing rather than dangling (issue #35).
      return regionById(this._document(), ref.id)
        ? { kind: 'region', id: ref.id }
        : null;
    }
    const hex = this._document().hexes[coordKey(ref.coord)];
    if (!hex) return null;
    return hex.feature
      ? { kind: 'feature', coord: ref.coord }
      : { kind: 'hex', coord: ref.coord };
  });

  /**
   * The currently-selected {@link Label} resolved from the live document, or
   * `null` when the selection is not a Label, or its id no longer exists (e.g.
   * after an undo removed it). The inspector binds to this to edit the label.
   */
  readonly selectedLabel = computed<Label | null>(() => {
    const sel = this.selection();
    if (sel?.kind !== 'label') return null;
    return this._document().labels.find((l) => l.id === sel.id) ?? null;
  });

  /**
   * The currently-selected {@link Region} resolved from the live document, or
   * `null` when the selection is not a Region (or its id is gone after an undo).
   * Peer to {@link selectedLabel}: the Inspector binds to this to edit the
   * Region's name, color, and deletion (issue #36).
   */
  readonly selectedRegion = computed<Region | null>(() => {
    const sel = this.selection();
    if (sel?.kind !== 'region') return null;
    return regionById(this._document(), sel.id) ?? null;
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
    // Arming Region with no remembered Subtool but regions to paint would leave
    // the tool inert (every stroke a silent no-op) behind a live-looking legend.
    // Default to the first region so the tool is immediately usable; a genuinely
    // region-less document still arms nothing, per "Region → none" (issue #27).
    if (id === 'region' && !this._region()) {
      const first = this._document().regions[0];
      if (first) this._region.set({ id: first.id, mode: 'add' });
    }
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
        const sub = featureSubtools[n - 1];
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
    // never paints (issue #27). The Subtool memory (and the selected label) all
    // referenced the previous document, so reset them to the cold-start defaults
    // rather than leaving a dangling region or label id behind.
    this._tool.set('select');
    this.resetSubtoolMemory();
    this.deselect(); // clears the selection and forgets the per-coordinate cycle
  }

  /** Restore the cold-start Subtool memory shared by a fresh store and a reload. */
  private resetSubtoolMemory(): void {
    this._terrain.set(DEFAULT_TERRAIN);
    this._feature.set(DEFAULT_FEATURE);
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
   * Move a whole Hex's content — terrain *and* feature — from `from` to `to`
   * (issue #30, ADR-0010). The origin becomes Void and an occupied destination
   * is overwritten, so the move never silently duplicates a hex. Region
   * memberships at both coordinates are left untouched: a Region is a location
   * overlay keyed by coordinate, not a property of the painted cell, so it stays
   * put while the content slides out from under it. The whole move is one
   * `commit`, so a single undo restores both ends — the origin and any clobbered
   * destination. Moving Void, or onto the same coordinate, changes nothing and
   * records no undo step.
   */
  moveHex(from: Axial, to: Axial): void {
    const fromKey = coordKey(from);
    const toKey = coordKey(to);
    if (fromKey === toKey) return;
    // Snapshot the origin's content from the live (immutable) document. Moving
    // Void carries nothing, so bail before `commit` records an empty step.
    const content = this._document().hexes[fromKey];
    if (!content) return;
    this.commit((draft) => {
      // Deep-clone the snapshot into the destination (overwriting it) and clear
      // the origin. Cloning the immutable source — rather than rebuilding the Hex
      // field-by-field — avoids aliasing a draft node at two keys *and* carries
      // every field along, so a future Hex field is never silently dropped.
      draft.hexes[toKey] = deepClone(content);
      delete draft.hexes[fromKey];
    });
    // The content moved, so a selection that pointed at the origin rides along to
    // the destination — completing a move keeps the moved Hex selected, matching
    // the Label-drag path (and the Escape-cancel path, which leaves it put). Copy
    // the coordinate rather than aliasing the caller's `to`, so a coord the caller
    // later mutates (e.g. a reused hover object) can't retarget the selection.
    const sel = this._selection();
    if (sel?.kind === 'cell' && coordKey(sel.coord) === fromKey) {
      this._selection.set({ kind: 'cell', coord: { q: to.q, r: to.r } });
    }
    // Stamp the post-move selection onto the edit so undo restores it to the
    // origin and redo follows it back to the destination, in lockstep with the
    // document — the move's `commit` always records a step, so an edit exists.
    this.trackSelectionOnLastEdit();
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

  /**
   * Delete the region `id` entirely, along with its membership set, clearing the
   * selection if it pointed at it. Peer to {@link deleteLabel}: it owns its own
   * selection teardown, so every caller — the Inspector and palette Delete
   * buttons, and {@link deleteSelected} — gets correct, single-step undo without
   * re-deriving the cleanup at the call site (issue #36).
   */
  deleteRegion(id: string): void {
    const committed = this.commit((draft) => {
      const at = draft.regions.findIndex((r) => r.id === id);
      if (at !== -1) draft.regions.splice(at, 1);
    });
    const sel = this._selection();
    if (sel?.kind === 'region' && sel.id === id) this.deselect();
    // The Region Subtool now points at a region that no longer exists. Forget it,
    // and if the Region tool is armed, fall back to the non-destructive Select so
    // the canvas stays inert rather than silently no-opping every stroke. This
    // disarm is session-only tool state (issue #27, ADR-0010), so — unlike the
    // document and selection above — it is deliberately NOT part of the undoable
    // edit: undoing the deletion restores the Region but leaves the tool on Select.
    if (this._region()?.id === id) {
      this._region.set(null);
      if (this._tool() === 'region') this._tool.set('select');
    }
    // Record the cleared selection on the edit (only if one was actually made) so
    // undo restores it with the region and redo clears it again.
    if (committed) this.trackSelectionOnLastEdit();
  }

  /**
   * Run `mutate` against the region `id` through `commit`; a no-op (no undo step)
   * if there is no such region. The shared find-and-guard for the per-field region
   * edits (rename, recolor).
   */
  private updateRegion(id: string, mutate: (region: Region) => void): void {
    this.commit((draft) => {
      const region = regionById(draft, id);
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
      const region = regionById(draft, id);
      if (region) region.hexes[coordKey(coord)] = true;
    });
  }

  /** Remove the hex at `coord` from region `id`; a no-op if it was not a member. */
  removeHexFromRegion(id: string, coord: Axial): void {
    this.commit((draft) => {
      delete regionById(draft, id)?.hexes[coordKey(coord)];
    });
  }

  /**
   * Select the topmost entity given a click's geometric inputs (issue #28): the
   * hex `coord` under the pointer and the `labelHit` from `renderer.labelAt`
   * (the id of the Label drawn there, or `null`). Precedence lives here, at the
   * store seam, so it stays unit-testable: a Label hit wins; otherwise a painted
   * cell is selected (it reads as a Feature or a bare Hex per the live document);
   * a Void coordinate with no label hit clears the selection (CONTEXT.md →
   * Select, ADR-0010). Returns the resolved {@link Selection} so the caller can
   * branch on it (e.g. start a label drag) without re-scanning the document.
   */
  select(coord: Axial, labelHit: string | null): Selection | null {
    const stack = this.candidatesAt(coord, labelHit);
    // Empty stack = a click on empty space (Void in no Region, no label hit) →
    // deselect through the one canonical clear so it shares `deselect`'s teardown
    // (which also forgets the cycle, so the next click starts fresh) (issue #35).
    if (stack.length === 0) {
      this.deselect();
      return null;
    }
    // The cycle descends only while clicks land on the same coordinate (and label
    // hit); a different anchor resets to the top. When the anchor repeats, the
    // *next* candidate is the one after wherever the live selection sits in the
    // freshly-resolved stack — so the descent position is derived from current
    // state, not a stored index that other selection changes (a label drop, a Hex
    // move, an undo, a candidate added/removed) could leave stale (issue #35).
    // A selection that is no longer a candidate here (it moved, or vanished)
    // starts the cycle fresh at the top; wrapping past the last returns to the
    // first.
    const anchor = `${coordKey(coord)}|${labelHit ?? ''}`;
    let index = 0;
    if (anchor === this.cycleAnchor) {
      const current = this._selection();
      const at = current
        ? stack.findIndex((ref) => sameSelectionRef(ref, current))
        : -1;
      if (at !== -1) index = (at + 1) % stack.length;
    }
    this.cycleAnchor = anchor;
    this._selection.set(stack[index]);
    return this.selection();
  }

  /**
   * The selection candidates under a click, deepest-last, as the references the
   * cycle steps through: the Label hit (if any), then the painted cell (if any),
   * then every Region whose membership contains the coordinate in document order.
   * Whether the cell reads as a Feature or a bare Hex is left to {@link selection}
   * to derive; this only records that the cell is a candidate (issue #35).
   */
  private candidatesAt(coord: Axial, labelHit: string | null): SelectionRef[] {
    const refs: SelectionRef[] = [];
    if (labelHit !== null) refs.push({ kind: 'label', id: labelHit });
    // Copy the coordinate rather than aliasing the caller's object, so a coord it
    // later mutates (e.g. a reused hover object) can't retarget the selection.
    const key = coordKey(coord);
    if (this._document().hexes[key]) {
      refs.push({ kind: 'cell', coord: { q: coord.q, r: coord.r } });
    }
    for (const region of this._document().regions) {
      if (region.hexes[key]) refs.push({ kind: 'region', id: region.id });
    }
    return refs;
  }

  /** Select the Label `id` for editing in the inspector, or `null` to clear it. */
  selectLabel(id: string | null): void {
    if (id === null) this.deselect();
    else this._selection.set({ kind: 'label', id });
  }

  /**
   * Clear the selection, if any — the inspector falls back to its empty state.
   * The one canonical clear that every clearing path routes through: the
   * deliberate Escape gesture (issue #30), the internal teardown paths
   * ({@link selectLabel} with `null`, {@link deleteLabel}, {@link deleteSelected}),
   * and the incidental clear when {@link select} lands on a Void coordinate.
   */
  deselect(): void {
    this._selection.set(null);
    // Forget the cycle so a click that re-selects the same coordinate later starts
    // from the top of the stack rather than resuming a stale descent (issue #35).
    this.cycleAnchor = null;
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
    const committed = this.commit((draft) => {
      const at = draft.labels.findIndex((l) => l.id === id);
      if (at !== -1) draft.labels.splice(at, 1);
    });
    const sel = this._selection();
    if (sel?.kind === 'label' && sel.id === id) this.deselect();
    // Record the cleared selection on the edit (only if one was actually made) so
    // undo restores it with the label and redo clears it again.
    if (committed) this.trackSelectionOnLastEdit();
  }

  /**
   * Delete the current selection, dispatching on what is selected (issue #29):
   * a Label is removed; a Feature has only its feature cleared (its terrain
   * stays); a Hex has its whole record erased (back to Void), as if the Erase
   * Tool were applied there. Nothing selected is a no-op. Like every edit it
   * goes through `commit`, so the deletion is undoable. The selection is cleared
   * afterwards so the inspector never shows a stale selection — the single
   * delete gesture behind `Delete`/`Backspace` and the inspector's Delete action.
   */
  deleteSelected(): void {
    const sel = this.selection();
    if (!sel) return;
    // Label and Region have self-cleaning deletes — they clear the selection and
    // stamp the edit themselves (the same paths the Inspector's Delete buttons
    // use), so routing through them finishes the gesture. A selected Region is
    // destroyed through that single-step `deleteRegion` (issue #36) — membership
    // trimming never destroys a Region, so this and `deleteRegion` are the only
    // two ways one ceases to be.
    if (sel.kind === 'label') return this.deleteLabel(sel.id);
    if (sel.kind === 'region') return this.deleteRegion(sel.id);
    // A Hex/Feature erases through the general-purpose tool methods, which leave
    // the selection alone (a tool stroke must not deselect). The erase recorded a
    // step (the selection resolved an entity that existed), so clear the selection
    // and stamp it on that edit, so undo restores both the entity and its
    // selection together.
    if (sel.kind === 'feature') this.clearFeatureAt(sel.coord);
    else this.eraseAt(sel.coord);
    this.deselect();
    this.trackSelectionOnLastEdit();
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

  /** Reverse the most recent edit, restoring the selection it was made under. */
  undo(): void {
    const edit = this.undoStack.pop();
    if (!edit) return;
    this._document.set(applyPatches(this._document(), edit.undo));
    // Move the selection back in lockstep with the document, so undoing a move
    // re-selects the hex at its origin rather than leaving a stale reference at
    // the (now-reverted) destination.
    this._selection.set(edit.selectionBefore);
    this.redoStack.push(edit);
    this.syncHistory();
  }

  /** Re-apply the most recently undone edit, restoring its resulting selection. */
  redo(): void {
    const edit = this.redoStack.pop();
    if (!edit) return;
    this._document.set(applyPatches(this._document(), edit.redo));
    this._selection.set(edit.selectionAfter);
    this.undoStack.push(edit);
    this.syncHistory();
  }

  /**
   * Run `recipe` through Immer and adopt the result, recording the forward and
   * inverse patches so the edit can be undone and redone. Returns whether a step
   * was actually recorded — callers that re-point the selection afterwards use it
   * to know an edit exists to {@link trackSelectionOnLastEdit stamp} it onto.
   */
  private commit(recipe: (draft: HexMap) => void): boolean {
    // Snapshot the selection as it stood before the edit; undo restores it.
    const selectionBefore = this._selection();
    const [next, redo, undo] = produceWithPatches(this._document(), recipe);
    // No patches means the recipe changed nothing (e.g. erasing Void). Recording
    // it would leave empty undo steps and needlessly discard the redo branch.
    if (redo.length === 0) return false;
    this._document.set(next);
    // `selectionAfter` defaults to the before-state; the few edits that re-point
    // or clear the selection update it via trackSelectionOnLastEdit.
    this.undoStack.push({ redo, undo, selectionBefore, selectionAfter: selectionBefore });
    // A fresh edit forks history: the old redo branch can no longer be reached.
    this.redoStack.length = 0;
    this.syncHistory();
    return true;
  }

  /**
   * Stamp the current selection onto the most recent edit as its `selectionAfter`,
   * so redo restores it. Called by the edits that re-point or clear the selection
   * after committing (a Hex move, a delete); every other edit leaves it equal to
   * `selectionBefore`, which is already correct.
   */
  private trackSelectionOnLastEdit(): void {
    const edit = this.undoStack[this.undoStack.length - 1];
    if (edit) edit.selectionAfter = this._selection();
  }

  /** Mirror the stack depths into the reactive availability signals. */
  private syncHistory(): void {
    this._canUndo.set(this.undoStack.length > 0);
    this._canRedo.set(this.redoStack.length > 0);
  }
}

/**
 * Whether two selection references point at the same entity: a cell by its
 * coordinate, a label or a region by its id. Lets {@link EditorStore.select}
 * locate the live selection within a freshly-resolved candidate stack to derive
 * the cycle's descent position, rather than tracking a separate index (issue #35).
 */
function sameSelectionRef(a: SelectionRef, b: SelectionRef): boolean {
  if (a.kind === 'cell' && b.kind === 'cell') {
    return coordKey(a.coord) === coordKey(b.coord);
  }
  if (a.kind === 'label' && b.kind === 'label') return a.id === b.id;
  if (a.kind === 'region' && b.kind === 'region') return a.id === b.id;
  return false;
}

/** A unique id, preferring crypto.randomUUID but falling back where it is unavailable (insecure contexts). */
function mintId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'r-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/**
 * Deep-clone a JSON-shaped value, preferring `structuredClone` but falling back
 * to a JSON round-trip where it is unavailable (older runtimes, some SSR/test
 * shims) — the same defensive pattern as {@link mintId}'s `crypto.randomUUID`
 * guard. The document is JSON-serializable (it is persisted as JSON), so the
 * fallback is faithful for every value a Hex can hold.
 */
function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

/** A committed edit, as the forward and inverse Immer patches that effect it. */
interface Edit {
  readonly redo: Patch[];
  readonly undo: Patch[];
  /** The selection just before this edit — restored on undo so it tracks the document. */
  readonly selectionBefore: SelectionRef | null;
  /** The selection just after this edit (and any post-commit re-point) — restored on redo. */
  selectionAfter: SelectionRef | null;
}
