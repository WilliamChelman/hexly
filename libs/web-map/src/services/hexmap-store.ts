import { computed, effect, inject, Injectable, signal } from '@angular/core';
import {
  addPoint,
  Axial,
  coordKey,
  EntityBody,
  FeatureId,
  featureLibrary,
  gridOf,
  hasHexGrid,
  HexMap,
  Label,
  MovePlan,
  planMove,
  Point,
  Region,
  regionById,
  TerrainId,
  terrainPalette,
} from '@hexly/domain';
import { Patch } from '@hexly/immer';
import { ENTITY_SESSION } from '@hexly/web-entity';
import { MapSelection } from './map-selection';
import type { Selection, SelectMode, SelectionRef } from './map-selection';

// Re-exported so existing callers keep importing the Selection types from here.
export type { Selection, SelectMode, SelectionRef } from './map-selection';

/**
 * A top-level Tool armed in the palette; exactly one armed, a canvas gesture
 * applies it. Variant Tools track a Subtool separately ({@link FeatureSubtool},
 * {@link RegionSubtool}, the terrain id).
 */
export type ToolId =
  | 'select'
  | 'terrain'
  | 'feature'
  | 'region'
  | 'label'
  | 'erase';

/**
 * The Feature tool's Subtool: a library feature to place, or `'clear'` to remove
 * a hex's feature (leaving its terrain).
 */
export type FeatureSubtool = FeatureId | 'clear';

/**
 * The Select tool's Subtool: `pick` click/cycle/move picker (boot default), or
 * `marquee` drag-rectangle box-select. Session-only memory, never in the document.
 */
export type SelectSubtool = 'pick' | 'marquee';

/** The Select tool's Subtools in palette/keyboard order — Pick first (the default). */
export const selectSubtools: readonly SelectSubtool[] = ['pick', 'marquee'];

/**
 * The membership brush's target: which region it paints, and whether it adds or
 * removes membership. `null` until armed via the Inspector's Add/Remove; none →
 * a Region stroke is a no-op.
 */
export interface RegionSubtool {
  readonly id: string;
  readonly mode: 'add' | 'remove';
}

/**
 * Draft-mutation recipes shared by the single deletes and the batched
 * {@link HexMapStore.deleteSelected} so they can't drift apart; callers wrap them
 * in a `commit`.
 */
function removeLabelFrom(draft: HexMap, id: string): void {
  const at = draft.labels.findIndex((l) => l.id === id);
  if (at !== -1) draft.labels.splice(at, 1);
}

function removeRegionFrom(draft: HexMap, id: string): void {
  const at = draft.regions.findIndex((r) => r.id === id);
  if (at !== -1) draft.regions.splice(at, 1);
}

function clearFeatureFrom(draft: HexMap, coord: Axial): void {
  delete draft.hexes[coordKey(coord)]?.feature;
}

function eraseHexFrom(draft: HexMap, coord: Axial): void {
  delete draft.hexes[coordKey(coord)];
}

/**
 * Set `target.entityId`, or delete it when `entityId` is undefined — a cleared
 * link is absent, not blank. A missing target (stale coordinate) is left untouched.
 */
function setOrClearLink(
  target: { entityId?: string } | undefined,
  entityId: string | undefined,
): void {
  if (!target) return;
  if (entityId !== undefined) target.entityId = entityId;
  else delete target.entityId;
}

/**
 * The Feature Tool's Subtools in palette/keyboard order: each library feature,
 * then Clear last. Single source of the index→Subtool mapping shared by the
 * keyboard and the palette keycaps.
 */
export const featureSubtools: readonly FeatureSubtool[] = [
  ...featureLibrary.map((f) => f.id),
  'clear',
];

/**
 * Colours a fresh Region cycles through, so two new Regions look distinct.
 * Keyed by the "Region N" number so the colour tracks the name.
 */
const NEW_REGION_COLORS = ['#7c9b86', '#b08a4e', '#6f7fae', '#a8674f', '#5f8c8c'];

/** Cold-start Subtool defaults — the state a fresh map and a reloaded map share. */
const DEFAULT_TERRAIN: TerrainId = 'forest';
const DEFAULT_FEATURE: FeatureSubtool = featureLibrary[0].id;

/** The default world-pixel height a freshly-placed Label is drawn at. */
export const DEFAULT_LABEL_SIZE = 28;

/**
 * The outcome of {@link HexMapStore.moveSelection}: `moved` committed a step,
 * `blocked` refused it, `noop` carried nothing.
 */
export type MoveOutcome = 'moved' | 'blocked' | 'noop';

/**
 * The Hex Map editor: tools, selection, and undo/redo over the grid — but no longer the
 * owner of the grid. The document is the hex-grid slice of the central
 * {@link EntitySession}'s body (ADR-0048, *Central store* amendment): reads project off
 * `session.body`, edits go through `session.mutate` (Immer, patches captured), and undo
 * pushes those inverse patches back through `session.applyPatches`. Nothing mutates the
 * document directly — that discipline is what keeps undo correct.
 *
 * Route-scoped, bound beside the session it drives (not `providedIn: 'root'`): it injects
 * the route-scoped {@link ENTITY_SESSION}, so it lives and dies with the open Entity.
 */
@Injectable()
export class HexMapStore {
  private readonly session = inject(ENTITY_SESSION);

  /**
   * The live document — the hex-grid slice of the session's body, recomputed once per
   * grid edit. Read-only to everyone (the store writes through {@link commit}, never here).
   */
  readonly document = computed<HexMap>(() => gridOf(this.session.body()));

  /**
   * The transient Selection: owns the reference set and click-cycle anchor,
   * resolved against the live document. The store projects its UI side effects
   * (Inspector opening, stale-brush disarm) from here.
   */
  private readonly sel = new MapSelection(this.document);

  /**
   * The armed {@link ToolId} a canvas gesture applies. Opens on the non-destructive
   * `select` so a stray first click never paints.
   */
  private readonly _tool = signal<ToolId>('select');
  readonly tool = this._tool.asReadonly();

  /**
   * Per-Tool Subtool memory — session-only, never in the document, undone, saved,
   * or restored across reloads. Re-arming a Tool restores its Subtool.
   */
  private readonly _terrain = signal<TerrainId>(DEFAULT_TERRAIN);
  private readonly _feature = signal<FeatureSubtool>(DEFAULT_FEATURE);
  private readonly _region = signal<RegionSubtool | null>(null);
  private readonly _selectSubtool = signal<SelectSubtool>('pick');

  /**
   * What floats in the dismissible right panel: the {@link Inspector}, the Regions
   * list, or `null` when closed (the default). Selecting an entity or Region opens
   * the Inspector; the right-edge rail toggles `regions` ⇄ closed. Session-only;
   * a fresh load ({@link resetForLoad}) resets it closed.
   */
  private readonly _rightPanel = signal<'inspector' | 'regions' | null>(null);
  readonly rightPanel = this._rightPanel.asReadonly();

  /** The remembered Select Subtool; the canvas reads this to choose its Select gesture. */
  readonly selectSubtool = this._selectSubtool.asReadonly();
  /** The remembered Terrain Subtool — the terrain a Terrain stroke paints. */
  readonly terrain = this._terrain.asReadonly();
  /** The remembered Feature Subtool — a library feature to place, or `'clear'`. */
  readonly feature = this._feature.asReadonly();
  /**
   * The armed membership brush's target, or `null`. Armed via the Inspector's
   * Add/Remove on the selected Region, not a palette Region tool.
   */
  readonly region = this._region.asReadonly();

  /**
   * The membership-paint direction the Inspector's Add ⇄ Remove toggle reflects,
   * derived from the armed Region's `mode` — the same state {@link applyAt} paints
   * by, so the toggle can't disagree with a stroke. An armed-but-not-selected
   * Region falls back to `add` so a freshly-selected Region never inherits the
   * previous direction.
   */
  readonly regionDirection = computed<'add' | 'remove'>(() => {
    const armed = this._region();
    if (!armed) return 'add';
    return armed.id === this.selectedRegion()?.id ? armed.mode : 'add';
  });

  /**
   * Whether the armed Tool keeps applying as the pointer drags across hexes.
   * Terrain, Erase, Region, and feature Clear are idempotent brushes; placing a
   * Feature or Label is a discrete stamp a drag must not duplicate.
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

  /** Selection state, delegated to {@link MapSelection}; re-exposed so callers read it from one place. */
  readonly selections = this.sel.selections;
  readonly selection = this.sel.selection;
  readonly selectedLabel = this.sel.selectedLabel;
  readonly selectedRegion = this.sel.selectedRegion;

  /** The document's Regions — a narrow view so consumers needn't subscribe to the whole document. */
  readonly regions = computed<Region[]>(() => this.document().regions);

  /** The Entity Link id on the single selected Map element; the Inspector's Entity Link control binds to this. */
  readonly selectedEntityLink = this.sel.selectedEntityLink;

  /** Committed edits, newest last — popped to undo, then parked on `redoStack`. */
  private readonly undoStack: Edit[] = [];
  private readonly redoStack: Edit[] = [];

  private readonly _canUndo = signal(false);
  private readonly _canRedo = signal(false);
  /** Whether there is an edit to undo / redo — drives the toolbar buttons. */
  readonly canUndo = this._canUndo.asReadonly();
  readonly canRedo = this._canRedo.asReadonly();

  constructor() {
    // Reset on a *fresh* load, not on our own edits (ADR-0048, *Central store*): the
    // session bumps loadGeneration only when a new Entity is adopted or the canvas is
    // cleared for a route swap. The undo patches and selection refs are tied to the old
    // body — undoing after a load would corrupt the new grid — so both are cleared here,
    // while an edit (which never bumps the counter) leaves history intact. The document
    // itself needs no reset: it is derived from the session's body, so it already tracks
    // the load.
    //
    // Reset on a *change* in the counter, compared against the value observed so far —
    // not merely on the effect running — so the reset is tied to a real load and not to
    // when effects happen to flush. The store is born clean, so its construction-time
    // generation needs no reset; only a later bump (or a bump between construction and
    // the first flush) triggers one.
    let seenGeneration = this.session.loadGeneration();
    effect(() => {
      const generation = this.session.loadGeneration();
      if (generation === seenGeneration) return;
      seenGeneration = generation;
      this.resetForLoad();
    });
  }

  /**
   * Arm the Tool `id`; Subtool memory is held separately, so switching Tools never
   * disturbs it. The palette never passes `region` — the brush is armed via
   * {@link armRegionDirection}.
   */
  armTool(id: ToolId): void {
    this._tool.set(id);
  }

  /** Flip the right column to the Regions list; selecting a Region yields it back to the Inspector. */
  showRegionsPanel(): void {
    this._rightPanel.set('regions');
  }

  /** Toggle the right panel between the Regions list and closed — never the Inspector. */
  toggleRegionsPanel(): void {
    this._rightPanel.set(this._rightPanel() === 'regions' ? null : 'regions');
  }

  /** Arm the Select tool with `subtool`, remembering it as the Select Subtool. */
  armSelectSubtool(subtool: SelectSubtool): void {
    this._selectSubtool.set(subtool);
    this._tool.set('select');
  }

  /** Arm the Terrain tool with terrain `id`, remembering it as the Terrain Subtool. */
  armTerrain(id: TerrainId): void {
    this._terrain.set(id);
    this._tool.set('terrain');
  }

  /** Arm the Feature tool with `subtool`, remembering it as the Feature Subtool. */
  armFeature(subtool: FeatureSubtool): void {
    this._feature.set(subtool);
    this._tool.set('feature');
  }

  /** Arm the Region tool targeting region `id` in `mode`, remembering it as the Region Subtool. */
  armRegion(id: string, mode: 'add' | 'remove'): void {
    this._region.set({ id, mode });
    this._tool.set('region');
  }

  /**
   * Arm the Region brush on the selected Region in `direction` — the Inspector's
   * Add ⇄ Remove toggle. No-op when nothing, or a non-Region, is selected.
   */
  armRegionDirection(direction: 'add' | 'remove'): void {
    const region = this.selectedRegion();
    if (region) this.armRegion(region.id, direction);
  }

  /**
   * Pick the `n`-th (1-based) Subtool of the armed Tool — the keyboard `1`–`9`
   * binding. Out-of-range indices and Tools without Subtools are no-ops; the
   * membership brush has no indexed Subtool (its target is the selected Region).
   */
  armSubtoolByIndex(n: number): void {
    switch (this._tool()) {
      case 'select': {
        const sub = selectSubtools[n - 1];
        if (sub) this.armSelectSubtool(sub);
        break;
      }
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
      default:
        break;
    }
  }

  /**
   * Reset the transient editor state a fresh load invalidates: undo/redo history (its
   * patches target the old body), the selection and its brush, the armed Tool, and the
   * dock. Driven by the session's {@link ENTITY_SESSION.loadGeneration} bump, not a
   * direct call — the document is derived from the session's body, so a load is a fresh
   * start with no map to set here (ADR-0048).
   */
  private resetForLoad(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.syncHistory();
    // Arm the non-destructive Select and reset memory that referenced the previous document.
    this._tool.set('select');
    this.resetSubtoolMemory();
    this.deselect();
    this._rightPanel.set(null);
  }

  /** Restore the cold-start Subtool memory shared by a fresh store and a reload. */
  private resetSubtoolMemory(): void {
    this._selectSubtool.set('pick');
    this._terrain.set(DEFAULT_TERRAIN);
    this._feature.set(DEFAULT_FEATURE);
    this._region.set(null);
  }

  /** Apply the armed Tool (and its Subtool) at `coord`, dispatching on the Tool. */
  applyAt(coord: Axial): void {
    switch (this._tool()) {
      case 'select':
        // Non-destructive; nothing to apply.
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
        // Paints the *selected* Region per Add/Remove; no Region selected → no-op.
        const selected = this.selectedRegion();
        if (!selected) break;
        if (this.regionDirection() === 'add') this.addHexToRegion(selected.id, coord);
        else this.removeHexFromRegion(selected.id, coord);
        break;
      }
      case 'label':
        // Labels are free-positioned, placed via `addLabel`, not the hex-stroke path.
        break;
    }
  }

  /**
   * Paint `terrain` at `coord`, creating the hex or replacing only its terrain.
   * Terrain and Feature are independent layers, so a terrain stroke must not wipe
   * a placed feature.
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
   * existing Hex, so placing on Void is a no-op — paint terrain first.
   */
  placeFeatureAt(coord: Axial, feature: FeatureId): void {
    this.commit((draft) => {
      const hex = draft.hexes[coordKey(coord)];
      if (hex) hex.feature = { ref: feature };
    });
  }

  /**
   * Remove the feature from the hex at `coord`, leaving its terrain. A featureless
   * hex or Void coordinate is untouched (no undo step).
   */
  clearFeatureAt(coord: Axial): void {
    this.commit((draft) => clearFeatureFrom(draft, coord));
  }

  /** Erase the hex at `coord`, deleting its record so the coordinate is Void. */
  eraseAt(coord: Axial): void {
    this.commit((draft) => eraseHexFrom(draft, coord));
  }

  /**
   * Set the name on the hex at `coord`. Naming a Void coordinate is a no-op; a
   * blank name deletes the field rather than storing an empty string.
   */
  editHexName(coord: Axial, name: string): void {
    const trimmed = name.trim();
    this.commit((draft) => {
      const hex = draft.hexes[coordKey(coord)];
      if (!hex) return;
      if (trimmed) hex.name = trimmed;
      else delete hex.name;
    });
  }

  /**
   * Point the single selected Map element at the Entity `entityId` (its Entity
   * Link). A no-op when the selection isn't a single linkable element.
   */
  linkEntity(entityId: string): void {
    this.setEntityLink(entityId);
  }

  /** Remove the selected Map element's Entity Link, deleting the field (no delete of either Entity). */
  unlinkEntity(): void {
    this.setEntityLink(undefined);
  }

  /** Set or clear the selected element's `entityId`; one commit so it is undoable. */
  private setEntityLink(entityId: string | undefined): void {
    const sel = this.selection();
    if (!sel) return;
    this.commit((draft) => {
      if (sel.kind === 'hex') {
        setOrClearLink(draft.hexes[coordKey(sel.coord)], entityId);
      } else if (sel.kind === 'feature') {
        setOrClearLink(draft.hexes[coordKey(sel.coord)]?.feature, entityId);
      } else if (sel.kind === 'region') {
        setOrClearLink(regionById(draft, sel.id), entityId);
      }
    });
  }

  /**
   * Each selected label's destination after nudging by `delta`, keyed by id —
   * shared by the preview and the {@link moveSelection commit} so they can't
   * drift. Empty for a zero `delta`, so no spurious label write.
   */
  private movedLabelPositions(
    labelIds: readonly string[],
    delta: Point,
  ): ReadonlyMap<string, Point> {
    const moved = new Map<string, Point>();
    if (delta.x === 0 && delta.y === 0) return moved;
    const byId = new Map(this.document().labels.map((l) => [l.id, l]));
    for (const id of labelIds) {
      const label = byId.get(id);
      if (label) moved.set(id, addPoint(label.position, delta));
    }
    return moved;
  }

  /**
   * What moving the live Selection by `offset`/`labelDelta` *would* produce,
   * without committing. The canvas reads this each drag frame, and
   * {@link moveSelection} derives its commit from it, so preview and landed move
   * can't disagree. Touches no signal, records no edit.
   */
  previewSelectionMove(
    offset: Axial,
    labelDelta: Point,
  ): { plan: MovePlan; labelPositions: ReadonlyMap<string, Point> } {
    const { hexes, labels, regions } = this.sel.partitionForMove();
    const plan = planMove({
      document: this.document(),
      selection: { hexes, regions },
      offset,
    });
    return { plan, labelPositions: this.movedLabelPositions(labels, labelDelta) };
  }

  /**
   * Move the whole live Selection by `offset` (axial hex delta) / `labelDelta`
   * (equivalent pixels) — the unified move every drag routes through. A blocked
   * plan is a no-op so the drag snaps back; a resolved plan applies in one
   * {@link commit} — one undo step however much is selected. The selection
   * re-points to the moved entities so the group stays selected.
   */
  moveSelection(offset: Axial, labelDelta: Point): MoveOutcome {
    if (
      offset.q === 0 &&
      offset.r === 0 &&
      labelDelta.x === 0 &&
      labelDelta.y === 0
    ) {
      return 'noop';
    }
    const { plan, labelPositions } = this.previewSelectionMove(offset, labelDelta);
    if (plan.blocked) return 'blocked';
    const committed = this.commit((draft) => {
      // Deep-clone planner records: they reference the immutable pre-move document,
      // so the draft never aliases a live node.
      for (const { coord, hex } of plan.hexes) {
        const key = coordKey(coord);
        if (hex) draft.hexes[key] = structuredClone(hex);
        else delete draft.hexes[key];
      }
      for (const { id, hexes: footprint } of plan.regions) {
        const region = regionById(draft, id);
        if (region) region.hexes = structuredClone(footprint);
      }
      for (const [id, position] of labelPositions) {
        const label = draft.labels.find((l) => l.id === id);
        if (label) label.position = position;
      }
    });
    // Plan changed nothing (empty selection, or every source Void): nothing to re-point.
    if (!committed) return 'noop';
    this.sel.repointByOffset(offset);
    // Stamp the post-move selection so undo/redo track the document in lockstep.
    this.trackSelectionOnLastEdit();
    return 'moved';
  }

  /**
   * Create an empty Region with `name`/`color`, returning its minted id.
   * Membership starts empty — hexes are painted afterwards.
   */
  createRegion(name: string, color: string): string {
    const id = mintId();
    this.commit((draft) => {
      draft.regions.push({ id, name, color, hexes: {} });
    });
    return id;
  }

  /**
   * Create a fresh empty "Region N" — the Regions panel's New Region action, the
   * only way to create a Region. Selects it (opening the Inspector to name it) and
   * arms the brush in Add for the create-then-draw flow. Returns the new id.
   */
  newRegion(): string {
    const { name, color } = this.nextRegionIdentity();
    const id = this.createRegion(name, color);
    this.selectRegion(id);
    this.armRegion(id, 'add');
    // Stamp the post-mint selection so undo/redo track it with the Region.
    this.trackSelectionOnLastEdit();
    return id;
  }

  /**
   * The name and palette colour the next minted Region takes. The number is max
   * existing "Region N" + 1, so a freed name/colour isn't immediately reused.
   */
  private nextRegionIdentity(): { name: string; color: string } {
    const used = this.document().regions.flatMap((r) => {
      const match = /^Region (\d+)$/.exec(r.name);
      return match ? [Number(match[1])] : [];
    });
    const n = used.length ? Math.max(...used) + 1 : 1;
    return { name: `Region ${n}`, color: NEW_REGION_COLORS[(n - 1) % NEW_REGION_COLORS.length] };
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
   * Delete the region `id` and its membership, clearing the selection if it
   * pointed at it — single-step undo for every caller.
   */
  deleteRegion(id: string): void {
    const committed = this.commit((draft) => removeRegionFrom(draft, id));
    this.sel.dropWhere((ref) => ref.kind === 'region' && ref.id === id);
    // The brush now points at a gone region: disarm, falling back to Select.
    // Session-only tool state, deliberately NOT in the undoable edit — undo
    // restores the Region but leaves the tool on Select.
    if (this._region()?.id === id) {
      this._region.set(null);
      if (this._tool() === 'region') this._tool.set('select');
    }
    // Stamp the cleared selection (if a step was made) so undo restores it with the region.
    if (committed) this.trackSelectionOnLastEdit();
  }

  /** Run `mutate` against region `id` through `commit`; no-op if there's no such region. */
  private updateRegion(id: string, mutate: (region: Region) => void): void {
    this.commit((draft) => {
      const region = regionById(draft, id);
      if (region) mutate(region);
    });
  }

  /**
   * Add the hex at `coord` to region `id`. Membership is an independent coordinate
   * set: a hex need not be painted, and a coordinate may belong to many regions.
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
   * Select given a click's geometric inputs — delegated to {@link MapSelection},
   * which owns the precedence (Label hit wins, else painted cell, else Void
   * clears) and the click-cycle. Returns the resolved {@link Selection} so the
   * caller can branch, then projects it onto the Inspector.
   */
  select(
    coord: Axial,
    labelHit: string | null,
    mode: SelectMode = 'replace',
  ): Selection | null {
    // A modifier click that changes nothing (empty Void) must not project the
    // panel either, leaving a rail-opened Regions list alone; `replace` always projects.
    const before = this.sel.snapshot();
    const result = this.sel.select(coord, labelHit, mode);
    if (mode === 'replace' || this.sel.snapshot() !== before) {
      this.projectPanelFromSelection();
    }
    return result;
  }

  /**
   * Select the Region `id` (the Regions panel's path, and the only way to reach an
   * empty Region). Opens the Inspector, then disarms a brush armed on a different
   * Region so it can't paint into a stale one.
   */
  selectRegion(id: string): void {
    this.sel.selectRegion(id);
    this.projectPanelFromSelection();
    if (this._region()?.id !== id) {
      this._region.set(null);
      if (this._tool() === 'region') this._tool.set('select');
    }
  }

  /**
   * Fold a marquee box-selection into the set: plain replaces, `additive`
   * accumulates. Opens the Inspector on the result, or closes it on an empty plain box.
   */
  marqueeSelect(hexes: Axial[], labelIds: string[], additive: boolean): void {
    this.sel.marqueeSelect(hexes, labelIds, additive);
    this.projectPanelFromSelection();
  }

  /**
   * The Selection a marquee commit *would* produce, without mutating — a pure
   * query the canvas reads each drag frame to preview the box.
   */
  marqueePreview(
    hexes: Axial[],
    labelIds: string[],
    additive: boolean,
  ): Selection[] {
    return this.sel.marqueePreview(hexes, labelIds, additive);
  }

  /** Select the Label `id` for editing in the inspector, or `null` to clear it. */
  selectLabel(id: string | null): void {
    this.sel.selectLabel(id);
    this.projectPanelFromSelection();
  }

  /**
   * Clear the selection — the one canonical clear every path routes through
   * (Escape, teardown, a plain click on Void). Closes the Inspector but leaves a
   * rail-opened Regions list.
   */
  deselect(): void {
    this.sel.deselect();
    this.projectPanelFromSelection();
  }

  /**
   * Project the Selection onto the right panel: a non-empty Selection opens the
   * Inspector; emptying it closes the Inspector but never a rail-opened Regions list.
   *
   * ponytail: a synchronous projection off the select commands, not a reactive `effect` on
   * {@link selections} — an effect needs an injection context and wouldn't run synchronously
   * under the plain-`new` store spec. Route a new panel rule through here.
   */
  private projectPanelFromSelection(): void {
    if (this.sel.selections().length > 0) this._rightPanel.set('inspector');
    else if (this._rightPanel() === 'inspector') this._rightPanel.set(null);
  }

  /**
   * Add a free-positioned Label with `text` at world `position` and default size,
   * returning its minted id.
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
   * Resize Label `id` to `size` world pixels; no-op if no such label. `size` must
   * be positive and finite (`labelSchema.size` is positive) or save/load fails; the
   * UI can send `0` or a negative, so the store is the deep guard.
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
    const committed = this.commit((draft) => removeLabelFrom(draft, id));
    this.sel.dropWhere((ref) => ref.kind === 'label' && ref.id === id);
    // Stamp the cleared selection (if a step was made) so undo restores it with the label.
    if (committed) this.trackSelectionOnLastEdit();
  }

  /**
   * Delete the whole Selection set, each member per its kind: Label removed,
   * Region destroyed with its membership, Feature cleared (terrain stays), Hex
   * erased to Void. One {@link commit}, so the whole deletion is one undo step.
   * Resolved against the live document first, so stale members delete nothing.
   */
  deleteSelected(): void {
    const sels = this.selections();
    if (sels.length === 0) return;
    const committed = this.commit((draft) => {
      for (const sel of sels) {
        switch (sel.kind) {
          case 'label':
            removeLabelFrom(draft, sel.id);
            break;
          case 'region':
            removeRegionFrom(draft, sel.id);
            break;
          case 'feature':
            clearFeatureFrom(draft, sel.coord);
            break;
          case 'hex':
            eraseHexFrom(draft, sel.coord);
            break;
        }
      }
    });
    // A brush armed on a destroyed Region would dangle: disarm, fall back to Select.
    // Session-only state, kept out of the undoable edit as in `deleteRegion`.
    for (const sel of sels) {
      if (sel.kind === 'region' && this._region()?.id === sel.id) {
        this._region.set(null);
        if (this._tool() === 'region') this._tool.set('select');
      }
    }
    // Clear the set and stamp it onto the edit so undo restores entities and selection together.
    this.deselect();
    if (committed) this.trackSelectionOnLastEdit();
  }

  /** Run `mutate` against Label `id` through `commit`; no-op if no such label. */
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
    // Replay the inverse patches through the session — it owns the body, so the grid
    // slice this store reads updates in lockstep (ADR-0048).
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
   * Run `recipe` through the session's {@link ENTITY_SESSION.mutate}, recording the
   * returned patches for undo/redo. Returns whether a step was recorded — callers that
   * re-point the selection use it to know an edit exists to
   * {@link trackSelectionOnLastEdit stamp}. The recipe touches only the hex-grid slice,
   * present iff the body carries a grid, so a note's body passes through untouched.
   */
  private commit(recipe: (draft: HexMap) => void): boolean {
    const selectionBefore = this.sel.snapshot();
    const { redo, undo } = this.session.mutate((body: EntityBody) => {
      if (hasHexGrid(body)) recipe(body);
    });
    // No patches → the recipe changed nothing; recording it would leave empty undo
    // steps and discard the redo branch.
    if (redo.length === 0) return false;
    // selectionAfter defaults to before; re-pointing edits update it via trackSelectionOnLastEdit.
    this.undoStack.push({ redo, undo, selectionBefore, selectionAfter: selectionBefore });
    // A fresh edit forks history: the old redo branch is unreachable.
    this.redoStack.length = 0;
    this.syncHistory();
    return true;
  }

  /**
   * Stamp the current selection onto the most recent edit as its `selectionAfter`
   * so redo restores it. Called by edits that re-point or clear the selection.
   */
  private trackSelectionOnLastEdit(): void {
    const edit = this.undoStack[this.undoStack.length - 1];
    if (edit) edit.selectionAfter = this.sel.snapshot();
  }

  /** Mirror the stack depths into the reactive availability signals. */
  private syncHistory(): void {
    this._canUndo.set(this.undoStack.length > 0);
    this._canRedo.set(this.redoStack.length > 0);
  }
}

/**
 * A unique id for a region/label. `crypto.randomUUID` is secure-context-only —
 * undefined over plain HTTP on a LAN, the intended self-hosted deployment — so the
 * fallback covers that (internal ids: collision resistance is all that matters).
 * ponytail: keep the fallback — it's a real calibration knob, not dead code.
 */
function mintId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID();
  return 'r-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/** A committed edit, as the forward and inverse Immer patches that effect it. */
interface Edit {
  readonly redo: Patch[];
  readonly undo: Patch[];
  /** The selection set just before this edit — restored on undo so it tracks the document. */
  readonly selectionBefore: readonly SelectionRef[];
  /** The selection set just after this edit (and any post-commit re-point) — restored on redo. */
  selectionAfter: readonly SelectionRef[];
}
