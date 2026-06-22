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
 * - `region` — paint the *selected* region's membership; a no-op with none
 *   selected (creation moved to the Regions panel, ADR-0012)
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
 * The Select tool's Subtool (ADR-0017, amending ADR-0010): `pick` is the
 * click/cycle/move picker (the boot default, so a freshly-opened map behaves
 * exactly as before), `marquee` drags a rectangle to box-select the Hexes and
 * Labels within it. Like every Subtool it is session-only memory, never in the
 * document. The two are ordered `pick`, `marquee` so the keyboard `1`/`2` and
 * the palette keycaps index them from one source of truth.
 */
export type SelectSubtool = 'pick' | 'marquee';

/** The Select tool's Subtools in palette/keyboard order — Pick first (the default). */
export const selectSubtools: readonly SelectSubtool[] = ['pick', 'marquee'];

/**
 * The Region membership brush's target: which region the brush paints, and whether
 * it adds (`add`) or removes (`remove`) membership. `null` until a Region is selected
 * and a direction engaged via the Inspector's Add/Remove (issue #37); with none, a
 * Region stroke is a no-op (creation moved to the Regions panel, ADR-0012). It keeps
 * the historical `RegionSubtool`/`region()` name though Region is no longer a Tool.
 */
export interface RegionSubtool {
  readonly id: string;
  readonly mode: 'add' | 'remove';
}

/**
 * One selected entity (CONTEXT.md → Selection, ADR-0010/0011/0017): a Label or a
 * Region by id, or a Feature / Hex by the coordinate it sits on. The Selection is
 * a *set* of these — zero, one, or many — exposed as {@link EditorStore.selections}
 * (with {@link EditorStore.selection} the "exactly one" view). The store resolves a
 * click's geometric inputs into candidates by walking a per-coordinate stack —
 * `Label → Feature → Hex → each containing Region (document order)` — which a plain
 * click cycles through and the modifiers fold into the set; see {@link EditorStore.select}.
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
 * How a Select gesture folds into the Selection set (CONTEXT.md → Pick, ADR-0017):
 *
 * - `replace` — a plain click: replace the set with the topmost entity, and on a
 *   repeat at the same coordinate cycle deeper through the stack.
 * - `toggle-top` — Cmd/Ctrl-click: toggle just the topmost entity in or out.
 * - `toggle-stack` — Shift-click: toggle the whole stack at the coordinate (add
 *   the missing members, or remove them all when the pile is already fully in).
 * - `add-top` / `add-stack` — a modifier-held *drag*: the add-only counterparts of
 *   the toggles, used while sweeping the pointer across hexes so each one it enters
 *   accumulates into the set and re-entering a hex never removes it.
 */
export type SelectMode =
  | 'replace'
  | 'toggle-top'
  | 'toggle-stack'
  | 'add-top'
  | 'add-stack';

/**
 * Resolve one internal {@link SelectionRef} against the live document into the
 * public {@link Selection} it currently denotes, or `null` when it has gone stale
 * (its label/region id is gone, or its cell was erased). A cell reads as a
 * Feature when its hex carries one, else a bare Hex. This is the single place the
 * ref→Selection self-healing lives, shared by every selected member (issue #28).
 */
function resolveRef(doc: HexMap, ref: SelectionRef): Selection | null {
  if (ref.kind === 'label') {
    return doc.labels.some((l) => l.id === ref.id)
      ? { kind: 'label', id: ref.id }
      : null;
  }
  if (ref.kind === 'region') {
    return regionById(doc, ref.id) ? { kind: 'region', id: ref.id } : null;
  }
  const hex = doc.hexes[coordKey(ref.coord)];
  if (!hex) return null;
  return hex.feature
    ? { kind: 'feature', coord: ref.coord }
    : { kind: 'hex', coord: ref.coord };
}

/**
 * The draft-mutation recipes the delete paths share, factored out so the single
 * deletes ({@link EditorStore.deleteLabel}, {@link EditorStore.deleteRegion},
 * {@link EditorStore.clearFeatureAt}, {@link EditorStore.eraseAt}) and the
 * batched {@link EditorStore.deleteSelected} cannot drift apart. Each takes the
 * Immer draft and mutates it in place; deciding when to wrap them in a `commit`
 * (one step each vs. one step for the whole set) stays with the callers.
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
 * The Feature Tool's Subtools in palette/keyboard order: each library feature,
 * then the Clear Subtool last. The single source of truth for the index→Subtool
 * mapping the keyboard ({@link EditorStore.armSubtoolByIndex}) and the palette
 * keycaps share, so the two cannot drift (issue #27, ADR-0010).
 */
export const featureSubtools: readonly FeatureSubtool[] = [
  ...featureLibrary.map((f) => f.id),
  'clear',
];

/**
 * The colours a freshly-created Region cycles through, so two new Regions look
 * distinct without the user picking a colour first; they can recolour to anything
 * afterwards (the document stores an arbitrary `#rrggbb`). Keyed by the Region's
 * "Region N" number so the colour tracks the name (issue #8, #38, #39).
 */
const NEW_REGION_COLORS = ['#7c9b86', '#b08a4e', '#6f7fae', '#a8674f', '#5f8c8c'];

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
  private readonly _selectSubtool = signal<SelectSubtool>('pick');

  /**
   * Which view floats in the editor's dismissible right panel: the live
   * {@link Inspector}, the Regions panel's list, or `null` when the panel is
   * **closed** (ADR-0013). It is closed by default so nothing covers the map until
   * there is something to show: selecting an entity or a Region opens it to
   * `inspector` (the selection-opens-for-editing contract, ADR-0011, issue #39);
   * the right-edge rail toggles it between `regions` and closed. Transient,
   * session-only view state in the same category as the armed Tool and the
   * selection: never part of the `HexMap` document, never undone, saved, or
   * restored across reloads (a reopened map resets it closed via {@link load}).
   */
  private readonly _rightPanel = signal<'inspector' | 'regions' | null>(null);
  readonly rightPanel = this._rightPanel.asReadonly();

  /**
   * The remembered Select Subtool — `pick` (click/cycle/move) or `marquee`
   * (box-select). Boots at `pick` so a freshly-opened map behaves exactly as
   * before (ADR-0017). The canvas reads this to choose its Select gesture.
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
   * The membership-paint direction the Inspector's Add ⇄ Remove toggle reflects:
   * `add` paints a hex into the inspected Region, `remove` erases it. Derived from
   * the armed Region's `mode` — the *same* state {@link applyAt} paints by — so the
   * toggle is a single source of truth and can never disagree with what a stroke
   * actually does. The Inspector's Add/Remove ({@link armRegionDirection}) is now the
   * only path that arms the Region brush (ADR-0012).
   *
   * Scoped to the *selected* Region: the toggle belongs to the Inspector, which
   * edits the selection, and {@link applyAt} now paints the selected Region — so the
   * mode only counts while the armed Region IS the selected one. When the armed
   * Region is a stale, different one (a Region armed in Remove, then a *different*
   * Region selected), this falls back to `add` so a freshly-selected Region never
   * silently inherits the previous Region's direction (issue #38). Cold-starts at
   * `add` whenever no Region is armed too: a fresh store, a reloaded map, or after
   * the armed Region is deleted. In-memory, session-only editor state in the same
   * category as the armed Tool — never part of the `HexMap` document, never undone,
   * saved, or restored across reloads (issue #37).
   */
  readonly regionDirection = computed<'add' | 'remove'>(() => {
    const armed = this._region();
    if (!armed) return 'add';
    return armed.id === this.selectedRegion()?.id ? armed.mode : 'add';
  });

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
   * The Selection as a *set* of references, in selection order (ADR-0017): zero,
   * one, or many entities picked out by Select's clicks and modifiers. Transient
   * editor state — not part of the document, so it is neither undone nor persisted
   * (issues #10, #28). It holds only the references (a label/region id, or a cell
   * coordinate); the live {@link Selection.kind} and existence of each are resolved
   * from the document by {@link selections}, so the set self-heals member-by-member
   * when the document changes under it rather than going stale (issues #28, #35).
   */
  private readonly _selections = signal<readonly SelectionRef[]>([]);

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
   * each click from where the live single {@link _selections selection} sits in the
   * freshly-resolved stack (see {@link select}), so it can't go stale: any path that changes the
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
  readonly selections = computed<Selection[]>(() => {
    const doc = this._document();
    // Resolve every member against the live document, dropping any that have gone
    // stale (a label/region deleted, a cell erased, an undo) — the set self-heals
    // member-by-member rather than dangling (issues #28, #35).
    return this._selections().flatMap((ref) => {
      const resolved = resolveRef(doc, ref);
      return resolved ? [resolved] : [];
    });
  });

  /**
   * The single selected entity, or `null` when zero or two-or-more are selected —
   * the "exactly one" view the single-entity Inspector, {@link selectedLabel},
   * {@link selectedRegion}, and the single-Hex drag read. The renderer and the
   * multi-selection Inspector read the whole {@link selections} set instead. Like
   * the set it resolves against the live document, so it never goes stale.
   */
  readonly selection = computed<Selection | null>(() => {
    const all = this.selections();
    return all.length === 1 ? all[0] : null;
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

  /** The document's Regions — a narrow view so consumers (the Regions panel) needn't subscribe to the whole document. */
  readonly regions = computed<Region[]>(() => this._document().regions);

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
   * switching Tools never disturbs it (issue #27). The palette never passes `region`
   * (Region left the palette, ADR-0012); the Region membership brush is armed via the
   * Inspector's {@link armRegionDirection} on the selected Region.
   */
  armTool(id: ToolId): void {
    this._tool.set(id);
  }

  /**
   * Flip the shared right column to the Regions panel's list — the right-edge rail's
   * Regions entry (issue #39, ADR-0011). The reverse flip (back to the Inspector) is
   * not a separate command: it happens whenever a Region is selected, through
   * {@link selectRegion} and {@link newRegion}, so the list always yields to the
   * selection it produced.
   */
  showRegionsPanel(): void {
    this._rightPanel.set('regions');
  }

  /**
   * Toggle the floating right panel between the Regions list and closed — the
   * rail entry's click (issue #39, ADR-0013). Its off-state is **closed** (`null`),
   * not the Inspector: clicking the active Regions entry reclaims the right of the
   * map. From any other state (closed, or the Inspector showing a selection) it
   * opens the Regions list.
   */
  toggleRegionsPanel(): void {
    this._rightPanel.set(this._rightPanel() === 'regions' ? null : 'regions');
  }

  /**
   * Arm the Select tool with `subtool` — `pick` or `marquee` — remembering it as
   * the Select Subtool (ADR-0017). Peer to {@link armTerrain}/{@link armFeature};
   * the palette keycaps and keyboard `1`/`2` route through here.
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

  /**
   * Arm the Region tool targeting region `id` in `mode`, remembering it as the
   * Region Subtool.
   */
  armRegion(id: string, mode: 'add' | 'remove'): void {
    this._region.set({ id, mode });
    this._tool.set('region');
  }

  /**
   * Engage the Inspector's Add ⇄ Remove toggle in `direction`: arm the Region tool
   * on the currently-selected Region with it, collapsing select-then-edit into one
   * gesture (issue #37). This is the first control outside the palette permitted to
   * arm a Tool — Select itself still never paints. A no-op when nothing, or a
   * non-Region, is selected: the toggle only appears in the Region editor, but
   * guarding here keeps the action honest for every caller. Arming is the single
   * write that moves the toggle: {@link regionDirection} is derived from the armed
   * Subtool's mode, so there is no separate direction to keep in sync.
   */
  armRegionDirection(direction: 'add' | 'remove'): void {
    const region = this.selectedRegion();
    if (region) this.armRegion(region.id, direction);
  }

  /**
   * Pick the `n`-th (1-based) Subtool of the currently armed Tool — the keyboard
   * `1`–`9` binding (issue #27). The Subtool set is relative to the armed Tool:
   * Terrain → the terrain palette, Feature → the feature library then Clear.
   * Out-of-range indices and Tools without Subtools (Select, Label, Erase) are
   * no-ops; `region`, when armed as the membership brush, has no indexed Subtool
   * either (its target is the selected Region, ADR-0012).
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
    // A reopened map shows a clear right side: the panel resets closed, not the
    // previous session's list view nor an empty Inspector (ADR-0013, issue #39).
    this._rightPanel.set(null);
  }

  /** Restore the cold-start Subtool memory shared by a fresh store and a reload. */
  private resetSubtoolMemory(): void {
    this._selectSubtool.set('pick');
    this._terrain.set(DEFAULT_TERRAIN);
    this._feature.set(DEFAULT_FEATURE);
    this._region.set(null);
    // The membership direction is derived from the armed Region Subtool, so
    // clearing `_region` above already cold-starts `regionDirection` back to `add`.
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
        // The Region tool is a membership brush only now (ADR-0012): it paints the
        // *selected* Region's membership per the Add/Remove direction. Creation moved
        // to the Regions panel's New Region, so a stroke with no Region selected mints
        // nothing — it is a no-op rather than the old create-and-paint.
        const selected = this.selectedRegion();
        if (!selected) break;
        if (this.regionDirection() === 'add') this.addHexToRegion(selected.id, coord);
        else this.removeHexFromRegion(selected.id, coord);
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
    this.commit((draft) => clearFeatureFrom(draft, coord));
  }

  /** Erase the hex at `coord`, deleting its record so the coordinate is Void. */
  eraseAt(coord: Axial): void {
    this.commit((draft) => eraseHexFrom(draft, coord));
  }

  /**
   * Set the name on the hex at `coord` (ADR-0016). A name is a field on a Hex,
   * so naming a Void coordinate is a no-op — paint terrain first. A blank or
   * whitespace-only name clears the field entirely rather than leaving an empty
   * string, keeping the document minimal (the renderer draws nothing either way).
   * Like every edit it goes through `commit`, so a rename is a single undoable step.
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
    const refs = this._selections();
    const at = refs.findIndex(
      (ref) => ref.kind === 'cell' && coordKey(ref.coord) === fromKey,
    );
    if (at !== -1) {
      const next = refs.slice();
      const moved: SelectionRef = { kind: 'cell', coord: { q: to.q, r: to.r } };
      next[at] = moved;
      // The destination may already be in the set as its own cell ref; re-pointing
      // the origin onto it would leave the same cell twice. Drop every OTHER copy of
      // the moved ref, keeping the one we just re-pointed at index `at`.
      const deduped = next.filter(
        (ref, i) => i === at || !sameSelectionRef(ref, moved),
      );
      this._selections.set(deduped);
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

  /**
   * Create a fresh empty "Region N" with the next palette colour from the Regions
   * panel's New Region action — the *only* way to create a Region now (ADR-0012). It
   * mints no member hexes, so the new Region is invisible on the canvas and lives only
   * in the Regions panel until hexes are painted into it; the panel must not assume
   * non-empty membership (ADR-0011). It then selects the new Region (opening the
   * Inspector to name it) and arms the Region brush on it in Add, so the next stroke
   * adds straight into it — the fast create-then-draw flow, in one creation path.
   * Returns the new id. Like every edit it goes through `commit`, so undo removes it.
   */
  newRegion(): string {
    const { name, color } = this.nextRegionIdentity();
    const id = this.createRegion(name, color);
    // Select the new Region so the Inspector opens on it to be named, flipping the
    // shared column from the list back to the Inspector — the same routing a list
    // pick uses (selectRegion).
    this.selectRegion(id);
    // Arm the Region brush on it in Add so the next stroke paints hexes straight into
    // it (ADR-0012). The mint itself still adds no hex, so the Region is created
    // without painting; the canvas stroke is what fills it.
    this.armRegion(id, 'add');
    // Stamp the post-mint selection onto the edit so undo clears it with the Region
    // and redo restores it — the mint always records a step, so an edit exists.
    this.trackSelectionOnLastEdit();
    return id;
  }

  /**
   * The name and palette colour the next minted Region takes, used by
   * {@link newRegion}. The number is the next unused "Region N" (max existing + 1, or
   * 1 when none), so a name/colour freed by a deletion is not immediately reused; the
   * colour is keyed by that number so it tracks the name (issue #8, #38, #39).
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
   * Delete the region `id` entirely, along with its membership set, clearing the
   * selection if it pointed at it. Peer to {@link deleteLabel}: it owns its own
   * selection teardown, so every caller — the Inspector and palette Delete
   * buttons, and {@link deleteSelected} — gets correct, single-step undo without
   * re-deriving the cleanup at the call site (issue #36).
   */
  deleteRegion(id: string): void {
    const committed = this.commit((draft) => removeRegionFrom(draft, id));
    this.dropSelections((ref) => ref.kind === 'region' && ref.id === id);
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
  select(
    coord: Axial,
    labelHit: string | null,
    mode: SelectMode = 'replace',
  ): Selection | null {
    const stack = this.candidatesAt(coord, labelHit);
    if (mode === 'replace') return this.selectReplace(coord, labelHit, stack);

    // Modifier gestures fold into the set rather than cycling, so the per-coordinate
    // cycle is forgotten — a later plain click at the same coordinate starts fresh
    // at the top of the stack rather than resuming a stale descent (issue #35).
    this.cycleAnchor = null;
    // A modifier click/drag on empty space (Void in no Region, no label hit) adds
    // nothing and leaves the set — and the panel — exactly as they were; only a
    // *plain* click on empty space clears (CONTEXT.md → Pick).
    if (stack.length === 0) return this.selection();
    switch (mode) {
      case 'toggle-top':
        this.toggleRefs([stack[0]]);
        break;
      case 'toggle-stack':
        this.toggleStack(stack);
        break;
      case 'add-top':
        this.addRefs([stack[0]]);
        break;
      case 'add-stack':
        this.addRefs(stack);
        break;
    }
    this.openOrCloseAfterModifierSelect();
    return this.selection();
  }

  /**
   * The plain-click path: replace the set with the topmost entity under the click,
   * cycling deeper on a repeat at the same anchor. Empty space clears the whole
   * set through the one canonical {@link deselect}. The cycle descends only while
   * clicks land on the same coordinate (and label hit); a different anchor resets
   * to the top. The descent position is *derived* from where the live single
   * selection sits in the freshly-resolved stack — never a stored index — so a
   * label drop, a Hex move, an undo, or a candidate added/removed cannot leave it
   * stale (issue #35). A selection that is no longer a candidate (it moved, or
   * vanished, or the set holds more than one) starts the cycle fresh at the top.
   */
  private selectReplace(
    coord: Axial,
    labelHit: string | null,
    stack: SelectionRef[],
  ): Selection | null {
    if (stack.length === 0) {
      this.deselect();
      return null;
    }
    const anchor = `${coordKey(coord)}|${labelHit ?? ''}`;
    let index = 0;
    if (anchor === this.cycleAnchor) {
      // The cycle only ever runs on a single-entity selection, so a set of two or
      // more (built by modifiers) restarts the descent at the top.
      const current = this.singleRef();
      const at = current
        ? stack.findIndex((ref) => sameSelectionRef(ref, current))
        : -1;
      if (at !== -1) index = (at + 1) % stack.length;
    }
    this.cycleAnchor = anchor;
    this._selections.set([stack[index]]);
    // A canvas selection flips the shared column back to the Inspector so the
    // picked entity opens for editing (the _rightPanel contract, issue #39) — but
    // only on a real selection, never the empty-stack/deselect branch above.
    this._rightPanel.set('inspector');
    return this.selection();
  }

  /** The single selection ref when exactly one is selected, else `null` — the cycle's anchor of comparison. */
  private singleRef(): SelectionRef | null {
    const refs = this._selections();
    return refs.length === 1 ? refs[0] : null;
  }

  /**
   * Add each of `refs` to the set if absent, never removing — the accumulating
   * counterpart to {@link toggleRefs} that a modifier-held select-sweep uses, so
   * re-entering an already-selected hex mid-drag leaves it put rather than flicking
   * it off (ADR-0017).
   */
  private addRefs(refs: SelectionRef[]): void {
    const current = this._selections();
    // Dedup-preserving union via the shared {@link mergeRefs}. Only write when it
    // grew — mergeRefs only ever appends, so an unchanged length means every ref
    // was already present — keeping the no-op add cheap and signal-quiet.
    const merged = mergeRefs(current, refs);
    if (merged.length !== current.length) this._selections.set(merged);
  }

  /** Toggle each of `refs` in or out of the set: drop it if present, append it if absent. */
  private toggleRefs(refs: SelectionRef[]): void {
    const next = this._selections().slice();
    for (const ref of refs) {
      const at = next.findIndex((s) => sameSelectionRef(s, ref));
      if (at !== -1) next.splice(at, 1);
      else next.push(ref);
    }
    this._selections.set(next);
  }

  /**
   * Toggle a whole stack at once (Shift-click): remove every member when the pile
   * is already fully selected, otherwise add just the missing ones. So Shift-click
   * grows a heterogeneous pile into the set, and a second Shift-click on the same
   * fully-selected pile clears it back out (ADR-0017).
   */
  private toggleStack(stack: SelectionRef[]): void {
    const current = this._selections();
    // One O(1) membership index over the current set; the set stays an ordered
    // array, so the filter/concat below preserve selection order.
    const present = new Set(current.map(refKey));
    const has = (ref: SelectionRef) => present.has(refKey(ref));
    if (stack.every(has)) {
      const stackKeys = new Set(stack.map(refKey));
      this._selections.set(current.filter((s) => !stackKeys.has(refKey(s))));
    } else {
      this._selections.set([...current, ...stack.filter((ref) => !has(ref))]);
    }
  }

  /**
   * After a modifier select (toggle or add), open the Inspector when the set still
   * holds something, or tear down to the closed/cycle-forgotten state when a toggle
   * emptied it — the same routing a plain selection and {@link deselect} use, so a
   * toggle that removes the last member behaves exactly like clearing it. (Add-only
   * sweeps never empty the set, so they always open it.)
   */
  private openOrCloseAfterModifierSelect(): void {
    if (this._selections().length > 0) this._rightPanel.set('inspector');
    else this.deselect();
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

  /**
   * Select the Region `id` directly — by id, not by a clicked coordinate — and flip
   * the shared right column back to the Inspector so the selection opens for editing
   * (issue #39). This is the Regions panel's selection path and the *only* way to
   * reach an empty Region (one with no member hex, so no coordinate to click): it
   * routes through the same `_selections` set the canvas uses, replacing it with
   * just this Region, so a list pick highlights on the canvas and opens in the
   * Inspector exactly like a plain canvas pick (ADR-0011).
   * Peer to {@link selectLabel}. Selecting is transient view state, not an edit, so
   * it records no undo step.
   */
  selectRegion(id: string): void {
    this._selections.set([{ kind: 'region', id }]);
    this._rightPanel.set('inspector');
    // A membership brush armed on a *different* Region would otherwise stay armed,
    // so the next canvas stroke would silently paint into that stale Region rather
    // than this freshly-selected one (the brush is armed only via the Inspector's
    // Add/Remove, ADR-0012). Disarm it the same way deleteRegion does. When the
    // armed Region IS the one being selected, leave the brush armed.
    if (this._region()?.id !== id) {
      this._region.set(null);
      if (this._tool() === 'region') this._tool.set('select');
    }
  }

  /**
   * Fold a marquee box-selection into the Selection set (CONTEXT.md → Marquee,
   * ADR-0017): the `hexes` and `labelIds` the canvas resolved from the dragged
   * rectangle via the pure {@link marqueeHits} helper. A plain marquee
   * (`additive` false) *replaces* the set with exactly these; a Shift/Cmd marquee
   * (`additive` true) *adds* them, so several boxes accumulate, never removing an
   * already-selected member. Regions are never passed — they have no single
   * position, so the marquee can't reach them. Selecting opens the Inspector on
   * the result; a plain marquee that hit nothing clears the set like an empty
   * click. Transient view state — records no undo step.
   */
  marqueeSelect(hexes: Axial[], labelIds: string[], additive: boolean): void {
    const refs = marqueeRefs(hexes, labelIds);
    // A marquee isn't a per-coordinate click cycle, so forget any cycle anchor —
    // a later plain click starts fresh at the top of its stack (issue #35).
    this.cycleAnchor = null;
    if (additive) this.addRefs(refs);
    else this._selections.set(refs);
    // Open the Inspector on the result, mirroring a click select; an empty plain
    // marquee leaves nothing selected, so tear down to the closed state instead.
    if (this._selections().length > 0) this._rightPanel.set('inspector');
    else this.deselect();
  }

  /**
   * The Selection set a marquee {@link marqueeSelect commit} *would* produce for
   * the given `hexes`/`labelIds`, resolved against the live document — without
   * mutating anything. The canvas reads this each frame of a marquee drag to
   * highlight the contained elements live, so the box previews exactly what
   * releasing it would select (a featured cell shows as a Feature, just as the
   * commit would). A plain box previews only its own contents; an additive box
   * (Shift/Cmd) previews the committed set unioned with the box, the same merge
   * {@link addRefs} performs on release. A pure query — records no edit, opens no
   * panel, touches no signal.
   */
  marqueePreview(
    hexes: Axial[],
    labelIds: string[],
    additive: boolean,
  ): Selection[] {
    const refs = marqueeRefs(hexes, labelIds);
    // Additive previews build on the committed set (box refs appended, deduped via
    // the same {@link mergeRefs} the additive commit uses, so the preview can never
    // disagree with what release accumulates); a plain preview shows only the box,
    // since release replaces the set.
    const base = additive ? this._selections() : [];
    const merged = mergeRefs(base, refs);
    // Resolve against the live document, dropping any stale member — the same
    // self-heal {@link selections} applies, so the preview can't show a ghost.
    const doc = this._document();
    return merged.flatMap((ref) => {
      const resolved = resolveRef(doc, ref);
      return resolved ? [resolved] : [];
    });
  }

  /** Select the Label `id` for editing in the inspector, or `null` to clear it. */
  selectLabel(id: string | null): void {
    if (id === null) this.deselect();
    else {
      this._selections.set([{ kind: 'label', id }]);
      // Selecting flips the shared column back to the Inspector to open the label
      // for editing (the _rightPanel contract, issue #39).
      this._rightPanel.set('inspector');
    }
  }

  /**
   * Clear the selection, if any. The one canonical clear that every clearing path
   * routes through: the deliberate Escape gesture (issue #30), the internal
   * teardown paths ({@link selectLabel} with `null`, {@link deleteLabel},
   * {@link deleteSelected}), and the incidental clear when {@link select} lands on
   * a Void coordinate.
   */
  deselect(): void {
    this._selections.set([]);
    // Forget the cycle so a click that re-selects the same coordinate later starts
    // from the top of the stack rather than resuming a stale descent (issue #35).
    this.cycleAnchor = null;
    // Reclaim the map: the Inspector only floats while it has a selection to show,
    // so clearing the selection closes it — the mirror of the selection that opened
    // it, keeping the closed-by-default contract (ADR-0013). A Regions list opened
    // via the rail is not selection-driven, so it is left showing.
    if (this._rightPanel() === 'inspector') this._rightPanel.set(null);
  }

  /**
   * Drop every selection member matching `match` from the set, leaving the rest.
   * When that empties the set, the same panel/cycle teardown as {@link deselect}
   * runs so the Inspector closes and the cycle is forgotten; with members still
   * selected the panel stays open on the smaller set. The single-member delete
   * paths ({@link deleteLabel}, {@link deleteRegion}) route their selection
   * cleanup through here so removing one entity never strands the whole set.
   */
  private dropSelections(match: (ref: SelectionRef) => boolean): void {
    const remaining = this._selections().filter((ref) => !match(ref));
    if (remaining.length === this._selections().length) return;
    if (remaining.length === 0) this.deselect();
    else this._selections.set(remaining);
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
    const committed = this.commit((draft) => removeLabelFrom(draft, id));
    this.dropSelections((ref) => ref.kind === 'label' && ref.id === id);
    // Record the cleared selection on the edit (only if one was actually made) so
    // undo restores it with the label and redo clears it again.
    if (committed) this.trackSelectionOnLastEdit();
  }

  /**
   * Delete the whole Selection set, each member per its kind (issue #29, ADR-0017):
   * a Label is removed, a Region destroyed (with its membership), a Feature has
   * only its feature cleared (its terrain stays), a Hex has its whole record erased
   * (back to Void). An empty set is a no-op. The entire set is removed in a single
   * {@link commit}, so however many entities are selected the deletion is *one*
   * undoable step — the single delete gesture behind `Delete`/`Backspace` and the
   * Inspector's Delete (single) / Delete all (multi) action. The set is resolved
   * against the live document first, so stale members delete nothing.
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
    // A membership brush armed on any now-destroyed Region would dangle, so disarm
    // it and fall back to the inert Select — session-only tool state that, like in
    // `deleteRegion`, is deliberately kept out of the undoable edit (issue #27).
    for (const sel of sels) {
      if (sel.kind === 'region' && this._region()?.id === sel.id) {
        this._region.set(null);
        if (this._tool() === 'region') this._tool.set('select');
      }
    }
    // Clear the set so the Inspector never shows a stale selection, and stamp the
    // cleared set onto the edit so undo restores both the entities and the
    // selection together (only if a step was actually recorded).
    this.deselect();
    if (committed) this.trackSelectionOnLastEdit();
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
    this._selections.set(edit.selectionBefore);
    this.redoStack.push(edit);
    this.syncHistory();
  }

  /** Re-apply the most recently undone edit, restoring its resulting selection. */
  redo(): void {
    const edit = this.redoStack.pop();
    if (!edit) return;
    this._document.set(applyPatches(this._document(), edit.redo));
    this._selections.set(edit.selectionAfter);
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
    // Snapshot the selection set as it stood before the edit; undo restores it.
    const selectionBefore = this._selections();
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
    if (edit) edit.selectionAfter = this._selections();
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

/**
 * A stable string key for a {@link SelectionRef}, consistent with
 * {@link sameSelectionRef} (two refs share a key iff they are the same entity).
 * Lets the sweep-time membership tests build an O(1) `Set` index once rather than
 * re-scanning the growing set per swept hex (a quadratic over a long drag).
 */
/**
 * Build the {@link SelectionRef}s a marquee box denotes from its resolved
 * `hexes` and `labelIds` (CONTEXT.md → Marquee): a cell ref per hex coordinate,
 * a label ref per id. The shared ref-builder behind both {@link
 * EditorStore.marqueeSelect} (which commits them) and {@link
 * EditorStore.marqueePreview} (which resolves them for the live highlight), so
 * the previewed box can never disagree with what releasing it selects. Each
 * coordinate is copied, never aliased, so a caller's reused hover object can't
 * retarget a ref later.
 */
function marqueeRefs(hexes: Axial[], labelIds: string[]): SelectionRef[] {
  return [
    ...hexes.map((coord) => ({
      kind: 'cell' as const,
      coord: { q: coord.q, r: coord.r },
    })),
    ...labelIds.map((id) => ({ kind: 'label' as const, id })),
  ];
}

/**
 * Append `refs` to `base`, skipping any whose entity is already present (by
 * {@link refKey} identity) — the dedup-preserving union shared by the additive
 * select path ({@link EditorStore.addRefs}, which commits it) and the marquee
 * preview ({@link EditorStore.marqueePreview}, which resolves it for the live
 * highlight), so an additive box's live preview can never disagree with what
 * releasing it accumulates. Returns a fresh array; `base` is never mutated, and
 * its order is preserved with the new members appended after it.
 */
function mergeRefs(
  base: readonly SelectionRef[],
  refs: readonly SelectionRef[],
): SelectionRef[] {
  const present = new Set(base.map(refKey));
  const merged = [...base];
  for (const ref of refs) {
    const key = refKey(ref);
    if (present.has(key)) continue;
    present.add(key);
    merged.push(ref);
  }
  return merged;
}

function refKey(ref: SelectionRef): string {
  switch (ref.kind) {
    case 'label':
      return `label:${ref.id}`;
    case 'region':
      return `region:${ref.id}`;
    case 'cell':
      return `cell:${coordKey(ref.coord)}`;
  }
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
  /** The selection set just before this edit — restored on undo so it tracks the document. */
  readonly selectionBefore: readonly SelectionRef[];
  /** The selection set just after this edit (and any post-commit re-point) — restored on redo. */
  selectionAfter: readonly SelectionRef[];
}
