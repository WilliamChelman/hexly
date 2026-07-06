import { computed, Injectable, signal } from '@angular/core';
import {
  addPoint,
  Axial,
  coordKey,
  emptyHexMap,
  FeatureId,
  featureLibrary,
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
import { applyPatches, Patch, produceWithPatches } from '@hexly/immer';
import { MapSelection } from './map-selection';
import type { Selection, SelectMode, SelectionRef } from './map-selection';

// The Selection types live with the module that owns them; re-exported so existing
// callers (map-canvas, inspector, map-renderer) keep importing them from here.
export type { Selection, SelectMode, SelectionRef } from './map-selection';

/**
 * A top-level Tool armed in the palette (CONTEXT.md → Tool); exactly one armed,
 * a canvas gesture applies it. Variant Tools track a Subtool separately
 * ({@link FeatureSubtool}, {@link RegionSubtool}, the terrain id):
 *
 * - `select` — non-destructive; a click does nothing yet (issue #27)
 * - `terrain` — paint the remembered terrain (creates or replaces a hex)
 * - `feature` — place the remembered feature, or Clear it (see FeatureSubtool)
 * - `region` — paint the *selected* region's membership; no-op with none selected (ADR-0012)
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
 * The Feature tool's Subtool: a library feature to place, or `'clear'` to remove
 * a hex's feature (leaving its terrain). Clear sits among the feature Subtools
 * because it's scoped to the feature layer (issue #27, ADR-0010).
 */
export type FeatureSubtool = FeatureId | 'clear';

/**
 * The Select tool's Subtool (ADR-0017): `pick` click/cycle/move picker (boot
 * default), `marquee` drag-rectangle box-select. Session-only memory, never in
 * the document. Ordered `pick`, `marquee` so keyboard `1`/`2` and the palette
 * keycaps index from one source of truth.
 */
export type SelectSubtool = 'pick' | 'marquee';

/** Which surface a multi-surface Entity's editor shows: the hex grid (`'map'`) or the Content body (`'note'`) (#75). */
export type EntityView = 'map' | 'note';

/** The Select tool's Subtools in palette/keyboard order — Pick first (the default). */
export const selectSubtools: readonly SelectSubtool[] = ['pick', 'marquee'];

/**
 * The membership brush's target: which region it paints, and whether it adds or
 * removes membership. `null` until a Region is selected and a direction engaged
 * via the Inspector's Add/Remove (issue #37); none → a Region stroke is a no-op
 * (ADR-0012).
 */
export interface RegionSubtool {
  readonly id: string;
  readonly mode: 'add' | 'remove';
}

/**
 * Draft-mutation recipes the delete paths share, so the single deletes and the
 * batched {@link HexMapStore.deleteSelected} can't drift apart. Each mutates the
 * Immer draft in place; callers decide when to wrap them in a `commit`.
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
 * Set `target.entityId` to `entityId`, or delete it when `entityId` is undefined —
 * keeping a cleared link absent rather than blank, like the Hex name (issue #76).
 * A missing target (stale coordinate) is left untouched.
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
 * then Clear last. One source of truth for the index→Subtool mapping shared by the
 * keyboard ({@link HexMapStore.armSubtoolByIndex}) and the palette keycaps
 * (issue #27, ADR-0010).
 */
export const featureSubtools: readonly FeatureSubtool[] = [
  ...featureLibrary.map((f) => f.id),
  'clear',
];

/**
 * Colours a fresh Region cycles through, so two new Regions look distinct without
 * the user picking one first (they can recolour afterwards). Keyed by the "Region
 * N" number so the colour tracks the name (issue #8, #38, #39).
 */
const NEW_REGION_COLORS = ['#7c9b86', '#b08a4e', '#6f7fae', '#a8674f', '#5f8c8c'];

/** Cold-start Subtool defaults — the state a fresh map and a reloaded map share. */
const DEFAULT_TERRAIN: TerrainId = 'forest';
const DEFAULT_FEATURE: FeatureSubtool = featureLibrary[0].id;

/** The default world-pixel height a freshly-placed Label is drawn at (issue #10). */
export const DEFAULT_LABEL_SIZE = 28;

/**
 * The outcome of {@link HexMapStore.moveSelection} (issue #64): `moved` committed
 * a step, `blocked` refused it (the caller may warn), `noop` carried nothing (a
 * drag that never moved, or an empty/void selection).
 */
export type MoveOutcome = 'moved' | 'blocked' | 'noop';

/**
 * The editor's command/undo stack — the only "store" the editor needs (ADR-0005).
 * Holds the {@link HexMap} as immutable signal state; every mutation runs through
 * Immer's `produceWithPatches`, inverse patches onto an undo stack. Nothing mutates
 * the document directly — that discipline is what makes undo correct.
 */
@Injectable({ providedIn: 'root' })
export class HexMapStore {
  private readonly _document = signal<HexMap>(emptyHexMap());
  /** The live document. Read-only to everyone but this store. */
  readonly document = this._document.asReadonly();

  /**
   * The transient Selection, extracted as its own module: it owns the reference set
   * and the click-cycle anchor and resolves them against the live document. The store
   * composes it (a read-only document dependency, one way) and projects its UI side
   * effects — opening the Inspector ({@link projectPanelFromSelection}), disarming a
   * stale Region brush — from here rather than baking them into the select paths.
   */
  private readonly sel = new MapSelection(this.document);

  /**
   * The armed {@link ToolId} a canvas gesture applies. Opens on the non-destructive
   * `select` so a stray first click never paints (issue #27).
   */
  private readonly _tool = signal<ToolId>('select');
  readonly tool = this._tool.asReadonly();

  /**
   * Per-Tool Subtool memory — session-only editor state, never in the document,
   * undone, saved, or restored across reloads (issue #27, ADR-0010). Re-arming a
   * Tool restores its Subtool. Cold-start: Terrain → `forest`, Feature → first
   * library feature, Region → none.
   */
  private readonly _terrain = signal<TerrainId>(DEFAULT_TERRAIN);
  private readonly _feature = signal<FeatureSubtool>(DEFAULT_FEATURE);
  private readonly _region = signal<RegionSubtool | null>(null);
  private readonly _selectSubtool = signal<SelectSubtool>('pick');

  /**
   * What floats in the dismissible right panel: the {@link Inspector}, the Regions
   * list, or `null` when **closed** (ADR-0013). Closed by default so nothing covers
   * the map: selecting an entity or Region opens it to `inspector` (ADR-0011, issue
   * #39); the right-edge rail toggles `regions` ⇄ closed. Session-only view state,
   * never in the document; {@link load} resets it closed.
   */
  private readonly _rightPanel = signal<'inspector' | 'regions' | null>(null);
  readonly rightPanel = this._rightPanel.asReadonly();

  /**
   * Which surface the editor shows: hex `'map'` grid or `'note'` Content body (#75).
   * Session-only like {@link rightPanel}, but mirrored to the URL `view` param so a
   * refresh or shared link keeps the open view — the session drives it from the
   * route, so {@link load} does not reset it.
   */
  private readonly _view = signal<EntityView>('map');
  readonly view = this._view.asReadonly();

  /**
   * The remembered Select Subtool — `pick` (click/cycle/move) or `marquee`
   * (box-select); boots at `pick` (ADR-0017). The canvas reads this to choose its
   * Select gesture.
   */
  readonly selectSubtool = this._selectSubtool.asReadonly();
  /** The remembered Terrain Subtool — the terrain a Terrain stroke paints. */
  readonly terrain = this._terrain.asReadonly();
  /** The remembered Feature Subtool — a library feature to place, or `'clear'`. */
  readonly feature = this._feature.asReadonly();
  /**
   * The armed membership brush's target — which region it paints and the brush
   * mode, or `null`. Armed via the Inspector's Add/Remove on the selected Region
   * (ADR-0012), not a palette Region tool.
   */
  readonly region = this._region.asReadonly();

  /**
   * The membership-paint direction the Inspector's Add ⇄ Remove toggle reflects,
   * derived from the armed Region's `mode` — the *same* state {@link applyAt} paints
   * by, so the toggle can't disagree with a stroke (ADR-0012). Scoped to the
   * *selected* Region: a stale armed-but-not-selected Region falls back to `add` so a
   * freshly-selected Region never inherits the previous direction (issue #38). Also
   * `add` when none is armed. Session-only, never persisted (issue #37).
   */
  readonly regionDirection = computed<'add' | 'remove'>(() => {
    const armed = this._region();
    if (!armed) return 'add';
    return armed.id === this.selectedRegion()?.id ? armed.mode : 'add';
  });

  /**
   * Whether the armed Tool keeps applying as the pointer drags across hexes.
   * Terrain, Erase, Region, and feature Clear are idempotent brushes — sweeping is
   * the intent. Placing a Feature (issue #7) and Label (issue #10) are discrete
   * stamps a drag must not duplicate; Select paints nothing (issue #27).
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
   * The Selection, resolved against the live document — delegated to the {@link
   * MapSelection} module that owns it. Re-exposed here so the store's callers (canvas,
   * inspector, renderer) keep reading selection state from one place.
   */
  readonly selections = this.sel.selections;
  readonly selection = this.sel.selection;
  readonly selectedLabel = this.sel.selectedLabel;
  readonly selectedRegion = this.sel.selectedRegion;

  /** The document's Regions — a narrow view so consumers (the Regions panel) needn't subscribe to the whole document. */
  readonly regions = computed<Region[]>(() => this._document().regions);

  /**
   * The Entity Link id on the single selected Map element — delegated to {@link
   * MapSelection}. The Inspector's Entity Link control binds to this (issue #76).
   */
  readonly selectedEntityLink = this.sel.selectedEntityLink;

  /** Committed edits, newest last — popped to undo, then parked on `redoStack`. */
  private readonly undoStack: Edit[] = [];
  private readonly redoStack: Edit[] = [];

  private readonly _canUndo = signal(false);
  private readonly _canRedo = signal(false);
  /** Whether there is an edit to undo / redo — drives the toolbar buttons. */
  readonly canUndo = this._canUndo.asReadonly();
  readonly canRedo = this._canRedo.asReadonly();

  /**
   * Arm the Tool `id` for the next gestures; Subtool memory is held separately, so
   * switching Tools never disturbs it (issue #27). The palette never passes `region`
   * — the brush is armed via {@link armRegionDirection} (ADR-0012).
   */
  armTool(id: ToolId): void {
    this._tool.set(id);
  }

  /**
   * Flip the right column to the Regions list (issue #39, ADR-0011). The reverse flip
   * isn't a separate command — selecting a Region ({@link selectRegion},
   * {@link newRegion}) yields the list back to the Inspector.
   */
  showRegionsPanel(): void {
    this._rightPanel.set('regions');
  }

  /**
   * Toggle the right panel between the Regions list and closed (issue #39, ADR-0013).
   * Off-state is **closed** (`null`), not the Inspector. From any other state it
   * opens the list.
   */
  toggleRegionsPanel(): void {
    this._rightPanel.set(this._rightPanel() === 'regions' ? null : 'regions');
  }

  /**
   * Arm the Select tool with `subtool`, remembering it as the Select Subtool
   * (ADR-0017). The palette keycaps and keyboard `1`/`2` route through here.
   */
  armSelectSubtool(subtool: SelectSubtool): void {
    this._selectSubtool.set(subtool);
    this._tool.set('select');
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

  /** Arm the Region tool targeting region `id` in `mode`, remembering it as the Region Subtool. */
  armRegion(id: string, mode: 'add' | 'remove'): void {
    this._region.set({ id, mode });
    this._tool.set('region');
  }

  /**
   * Engage the Inspector's Add ⇄ Remove toggle in `direction`: arm the Region brush
   * on the selected Region (issue #37). The only control outside the palette that
   * arms a Tool. No-op when nothing, or a non-Region, is selected. {@link
   * regionDirection} derives from the armed mode, so there's no separate direction
   * to sync.
   */
  armRegionDirection(direction: 'add' | 'remove'): void {
    const region = this.selectedRegion();
    if (region) this.armRegion(region.id, direction);
  }

  /**
   * Pick the `n`-th (1-based) Subtool of the armed Tool — the keyboard `1`–`9`
   * binding (issue #27). The set is relative to the armed Tool: Terrain → terrain
   * palette, Feature → feature library then Clear. Out-of-range indices and Tools
   * without Subtools are no-ops; the membership brush `region` has no indexed Subtool
   * (its target is the selected Region, ADR-0012).
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
   * Adopt `document` as the map being edited (issue #6). A fresh start, not an edit,
   * so undo/redo history is cleared — you can't undo back into the previous map.
   */
  load(document: HexMap): void {
    this._document.set(document);
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.syncHistory();
    // Arm the non-destructive Select so a stray click never paints (issue #27), and
    // reset Subtool/selection memory that referenced the previous document.
    this._tool.set('select');
    this.resetSubtoolMemory();
    this.deselect();
    // Reopened map shows a clear right side, reset closed (ADR-0013, issue #39).
    this._rightPanel.set(null);
    // Map/Note surface is NOT reset: it lives in the URL `view` param, which the
    // session restores on every (re)load, so a refresh keeps the open view (#75).
  }

  /** Switch the editor surface between the hex grid and the Content body (#75). */
  setView(view: EntityView): void {
    this._view.set(view);
  }

  /** Restore the cold-start Subtool memory shared by a fresh store and a reload. */
  private resetSubtoolMemory(): void {
    this._selectSubtool.set('pick');
    this._terrain.set(DEFAULT_TERRAIN);
    this._feature.set(DEFAULT_FEATURE);
    this._region.set(null);
    // regionDirection derives from `_region`, so clearing it above cold-starts it to `add`.
  }

  /** Apply the armed Tool (and its Subtool) at `coord`, dispatching on the Tool. */
  applyAt(coord: Axial): void {
    switch (this._tool()) {
      case 'select':
        // Select is non-destructive; a click does nothing yet (issue #27, ADR-0010).
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
        // Membership brush (ADR-0012): paints the *selected* Region per Add/Remove;
        // no Region selected → no-op (regions are created in the Regions panel).
        const selected = this.selectedRegion();
        if (!selected) break;
        if (this.regionDirection() === 'add') this.addHexToRegion(selected.id, coord);
        else this.removeHexFromRegion(selected.id, coord);
        break;
      }
      case 'label':
        // Labels are free-positioned, placed via `addLabel`, not the hex-stroke path
        // (CONTEXT.md → Label, issue #10).
        break;
    }
  }

  /**
   * Paint `terrain` at `coord`, creating the hex or replacing only its terrain.
   * Terrain and Feature are independent layers (CONTEXT.md), so a terrain stroke
   * must not wipe a placed feature — and painting is a sweeping drag.
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
   * existing Hex (CONTEXT.md), so placing on Void is a no-op — paint terrain first.
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
   * Set the name on the hex at `coord` (ADR-0016). Naming a Void coordinate is a
   * no-op — paint terrain first. A blank name clears the field rather than storing
   * an empty string, keeping the document minimal.
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
   * Link, issue #76). A Hex links the tile; the link rides in the document so it
   * round-trips through save/reload. A no-op when the selection isn't a single
   * linkable element.
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
   * Each selected label's destination after nudging by `delta`, keyed by id — shared
   * by the preview and the {@link moveSelection commit} so they can't drift. Empty
   * for a zero `delta`, so no spurious label write. Builds an id→label index once,
   * O(labels + selected) not a scan per id (issue #64).
   */
  private movedLabelPositions(
    labelIds: readonly string[],
    delta: Point,
  ): ReadonlyMap<string, Point> {
    const moved = new Map<string, Point>();
    if (delta.x === 0 && delta.y === 0) return moved;
    const byId = new Map(this._document().labels.map((l) => [l.id, l]));
    for (const id of labelIds) {
      const label = byId.get(id);
      if (label) moved.set(id, addPoint(label.position, delta));
    }
    return moved;
  }

  /**
   * What moving the live Selection by `offset`/`labelDelta` *would* produce, without
   * committing: the {@link MovePlan} (hex writes/clears + region-footprint shifts) and
   * each label's previewed position. The canvas reads this each drag frame, and
   * {@link moveSelection} derives its commit from it, so preview and landed move can't
   * disagree (issues #30, #64). Touches no signal, records no edit.
   */
  previewSelectionMove(
    offset: Axial,
    labelDelta: Point,
  ): { plan: MovePlan; labelPositions: ReadonlyMap<string, Point> } {
    const { hexes, labels, regions } = this.sel.partitionForMove();
    const plan = planMove({
      document: this._document(),
      selection: { hexes, regions },
      offset,
    });
    return { plan, labelPositions: this.movedLabelPositions(labels, labelDelta) };
  }

  /**
   * Move the whole live Selection by `offset` (issue #64, ADR-0017): the unified move
   * every drag routes through. {@link previewSelectionMove} resolves the translation,
   * intra-group overlap, and collisions; a **blocked** plan is a no-op so the drag
   * snaps back. A resolved plan applies in one {@link commit} (hexes, region
   * footprints, labels nudged by `labelDelta`) — one undo step however much is
   * selected. `offset` is the axial hex delta, `labelDelta` the equivalent pixels.
   * The selection re-points to the moved entities so the group stays selected; a
   * zero/zero drag carries nothing and records no step.
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
    // Blocked → refuse the whole move, leave everything untouched (CONTEXT.md).
    if (plan.blocked) return 'blocked';
    const committed = this.commit((draft) => {
      // Deep-clone planner records: they reference the immutable pre-move document,
      // so the draft never aliases a live node (every field carried verbatim).
      for (const { coord, hex } of plan.hexes) {
        const key = coordKey(coord);
        if (hex) draft.hexes[key] = structuredClone(hex);
        else delete draft.hexes[key];
      }
      for (const { id, hexes: footprint } of plan.regions) {
        const region = regionById(draft, id);
        if (region) region.hexes = structuredClone(footprint);
      }
      // Apply the previewed label positions; an empty map writes nothing.
      for (const [id, position] of labelPositions) {
        const label = draft.labels.find((l) => l.id === id);
        if (label) label.position = position;
      }
    });
    // Plan changed nothing (empty selection, or every source Void): nothing to re-point.
    if (!committed) return 'noop';
    // Re-point the selection so the group stays selected on the moved entities.
    this.sel.repointByOffset(offset);
    // Stamp the post-move selection so undo/redo track the document in lockstep.
    this.trackSelectionOnLastEdit();
    return 'moved';
  }

  /**
   * Create an empty Region with `name`/`color`, returning its minted id. Membership
   * starts empty — hexes are painted afterwards (issue #8).
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
   * *only* way to create a Region (ADR-0012). It mints no hexes, so the Region is
   * invisible until painted into; the panel must not assume non-empty membership
   * (ADR-0011). Selects it (opening the Inspector to name it) and arms the brush in
   * Add for the create-then-draw flow. Returns the new id.
   */
  newRegion(): string {
    const { name, color } = this.nextRegionIdentity();
    const id = this.createRegion(name, color);
    // Select it so the Inspector opens to name it (same routing as a list pick).
    this.selectRegion(id);
    // Arm the brush in Add so the next stroke paints into it (ADR-0012).
    this.armRegion(id, 'add');
    // Stamp the post-mint selection so undo/redo track it with the Region.
    this.trackSelectionOnLastEdit();
    return id;
  }

  /**
   * The name and palette colour the next minted Region takes. The number is max
   * existing "Region N" + 1 (or 1), so a freed name/colour isn't immediately reused;
   * the colour is keyed by that number so it tracks the name (issue #8, #38, #39).
   */
  private nextRegionIdentity(): { name: string; color: string } {
    const used = this._document().regions.flatMap((r) => {
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
   * Delete the region `id` and its membership, clearing the selection if it pointed
   * at it. Peer to {@link deleteLabel}: owns its selection teardown so every caller
   * gets single-step undo without re-deriving it (issue #36).
   */
  deleteRegion(id: string): void {
    const committed = this.commit((draft) => removeRegionFrom(draft, id));
    this.sel.dropWhere((ref) => ref.kind === 'region' && ref.id === id);
    // The brush now points at a gone region: forget it, falling back to Select so
    // the canvas isn't silently no-opping. Session-only tool state, deliberately NOT
    // in the undoable edit — undo restores the Region but leaves the tool on Select
    // (issue #27, ADR-0010).
    if (this._region()?.id === id) {
      this._region.set(null);
      if (this._tool() === 'region') this._tool.set('select');
    }
    // Stamp the cleared selection (if a step was made) so undo restores it with the region.
    if (committed) this.trackSelectionOnLastEdit();
  }

  /**
   * Run `mutate` against region `id` through `commit`; no-op if there's no such
   * region. Shared find-and-guard for the per-field region edits.
   */
  private updateRegion(id: string, mutate: (region: Region) => void): void {
    this.commit((draft) => {
      const region = regionById(draft, id);
      if (region) mutate(region);
    });
  }

  /**
   * Add the hex at `coord` to region `id`. Membership is an independent coordinate
   * set (a hex need not be painted; a coordinate may belong to many regions), so this
   * just sets the key.
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
   * Select given a click's geometric inputs — delegated to {@link MapSelection}, which
   * owns the precedence (a Label hit wins, else a painted cell, else a Void clears) and
   * the click-cycle. Returns the resolved {@link Selection} so the caller can branch
   * (e.g. start a label drag), then projects the Selection onto the Inspector.
   */
  select(
    coord: Axial,
    labelHit: string | null,
    mode: SelectMode = 'replace',
  ): Selection | null {
    // A `replace` click always resolves (it selects or clears); a modifier click only
    // engages when it lands on a candidate. A modifier click on empty Void changes
    // nothing — the module leaves the set reference untouched — so it must not project
    // the panel either, leaving a rail-opened Regions list alone (the pre-extraction
    // no-op early-returned before touching the panel).
    const before = this.sel.snapshot();
    const result = this.sel.select(coord, labelHit, mode);
    if (mode === 'replace' || this.sel.snapshot() !== before) {
      this.projectPanelFromSelection();
    }
    return result;
  }

  /**
   * Select the Region `id` by id (the Regions panel's path, and the *only* way to reach
   * an empty Region). Delegates the set change to {@link MapSelection}, opens the
   * Inspector on it, then disarms a brush armed on a *different* Region so it can't
   * paint into a stale one — tool state the Selection module doesn't own (ADR-0012).
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
   * Fold a marquee box-selection into the set — delegated to {@link MapSelection}: plain
   * replaces, Shift/Cmd (`additive`) accumulates. Opens the Inspector on the result, or
   * closes it on an empty plain box.
   */
  marqueeSelect(hexes: Axial[], labelIds: string[], additive: boolean): void {
    this.sel.marqueeSelect(hexes, labelIds, additive);
    this.projectPanelFromSelection();
  }

  /**
   * The Selection a marquee commit *would* produce, resolved against the live document
   * without mutating — delegated to {@link MapSelection}. The canvas reads this each
   * drag frame to preview the box. A pure query: no panel, no signal.
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
   * Clear the selection — the one canonical clear every path routes through (Escape,
   * teardown, a plain click on Void). Delegated to {@link MapSelection}, then closes the
   * Inspector (but leaves a rail-opened Regions list).
   */
  deselect(): void {
    this.sel.deselect();
    this.projectPanelFromSelection();
  }

  /**
   * Project the Selection onto the Inspector panel — the side effect the select paths
   * used to set inline (ADR-0011, ADR-0013): a non-empty Selection opens the Inspector;
   * emptying it closes the Inspector but never a rail-opened Regions list. Called from
   * the selection façade so the Selection module itself stays free of the panel.
   *
   * ponytail: a synchronous projection off the select commands, matching the prior
   * inline behaviour — not a reactive `effect` on {@link selections}. An effect would
   * also track self-heal (erasing the selected hex would close the Inspector), but it
   * needs an injection context and doesn't run synchronously under the plain-`new`
   * store spec. Route a new self-heal-driven panel rule through here or move to an
   * effect (with a TestBed harness) if that behaviour is ever wanted.
   */
  private projectPanelFromSelection(): void {
    if (this.sel.selections().length > 0) this._rightPanel.set('inspector');
    else if (this._rightPanel() === 'inspector') this._rightPanel.set(null);
  }

  /**
   * Add a free-positioned Label with `text` at world `position` and default size,
   * returning its minted id (issue #10). The caller typically selects it.
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
   * Resize Label `id` to `size` world pixels; no-op if no such label. `size` must be
   * positive and finite (`labelSchema.size` is `z.number().positive()`) or save/load
   * fails; the UI can send `0` (cleared field) or a negative, so the store is the deep
   * guard against it (issue #10).
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
   * Delete the whole Selection set, each member per its kind (issue #29, ADR-0017):
   * Label removed, Region destroyed with its membership, Feature cleared (terrain
   * stays), Hex erased to Void. One {@link commit}, so the whole deletion is *one*
   * undo step — behind `Delete`/`Backspace` and the Inspector's Delete actions.
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
            // Clear only the feature, leaving the terrain (as the Feature Clear Subtool).
            clearFeatureFrom(draft, sel.coord);
            break;
          case 'hex':
            // Erase the whole record, back to Void (as the Erase Tool).
            eraseHexFrom(draft, sel.coord);
            break;
        }
      }
    });
    // A brush armed on a destroyed Region would dangle: disarm, fall back to Select.
    // Session-only state, kept out of the undoable edit as in `deleteRegion` (issue #27).
    for (const sel of sels) {
      if (sel.kind === 'region' && this._region()?.id === sel.id) {
        this._region.set(null);
        if (this._tool() === 'region') this._tool.set('select');
      }
    }
    // Clear the set and stamp it onto the edit (if recorded) so undo restores entities
    // and selection together.
    this.deselect();
    if (committed) this.trackSelectionOnLastEdit();
  }

  /**
   * Run `mutate` against Label `id` through `commit`; no-op if no such label. Shared
   * find-and-guard for the per-field label edits.
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
    // Move the selection back in lockstep, so undoing a move re-selects the origin.
    this.sel.restore(edit.selectionBefore);
    this.redoStack.push(edit);
    this.syncHistory();
  }

  /** Re-apply the most recently undone edit, restoring its resulting selection. */
  redo(): void {
    const edit = this.redoStack.pop();
    if (!edit) return;
    this._document.set(applyPatches(this._document(), edit.redo));
    this.sel.restore(edit.selectionAfter);
    this.undoStack.push(edit);
    this.syncHistory();
  }

  /**
   * Run `recipe` through Immer, adopting the result and recording the patches for
   * undo/redo. Returns whether a step was recorded — callers that re-point the
   * selection use it to know an edit exists to {@link trackSelectionOnLastEdit stamp}.
   */
  private commit(recipe: (draft: HexMap) => void): boolean {
    // Snapshot the selection before the edit; undo restores it.
    const selectionBefore = this.sel.snapshot();
    const [next, redo, undo] = produceWithPatches(this._document(), recipe);
    // No patches → the recipe changed nothing (e.g. erasing Void); recording it would
    // leave empty undo steps and discard the redo branch.
    if (redo.length === 0) return false;
    this._document.set(next);
    // selectionAfter defaults to before; re-pointing edits update it via trackSelectionOnLastEdit.
    this.undoStack.push({ redo, undo, selectionBefore, selectionAfter: selectionBefore });
    // A fresh edit forks history: the old redo branch is unreachable.
    this.redoStack.length = 0;
    this.syncHistory();
    return true;
  }

  /**
   * Stamp the current selection onto the most recent edit as its `selectionAfter` so
   * redo restores it. Called by edits that re-point or clear the selection (move,
   * delete); others leave it equal to `selectionBefore`.
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
 * A unique id for a region/label. Prefers `crypto.randomUUID`, but it is
 * secure-context-only — undefined over plain HTTP on a LAN, the intended self-hosted
 * deployment, so the fallback covers that (internal ids: collision resistance is all
 * that matters, not unpredictability).
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
