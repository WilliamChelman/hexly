import { computed, signal, Signal } from '@angular/core';
import { addAxial, Axial, coordKey, HexMap, Label, Region, regionById } from '@hexly/domain';

/**
 * One selected entity (CONTEXT.md → Selection, ADR-0010/0011/0017): a Label or
 * Region by id, or a Feature / Hex by coordinate. The Selection is a *set* of
 * these, exposed as {@link MapSelection.selections} ({@link MapSelection.selection}
 * is the "exactly one" view). A click resolves a per-coordinate stack —
 * `Label → Feature → Hex → each containing Region (document order)` — which a
 * plain click cycles and modifiers fold into the set; see {@link MapSelection.select}.
 */
export type Selection =
  | { readonly kind: 'label'; readonly id: string }
  | { readonly kind: 'feature'; readonly coord: Axial }
  | { readonly kind: 'hex'; readonly coord: Axial }
  | { readonly kind: 'region'; readonly id: string };

/**
 * The internal selection reference the module holds: a Label or Region by id, or a
 * cell by coordinate. Whether a cell reads as a Feature or bare Hex, and whether a
 * Region still exists, are *derived* from the live document (see
 * {@link MapSelection.selection}), so the selection self-heals rather than going
 * stale when the document changes under it (issues #28, #35). Also the DTO the
 * store's undo/redo history carries across the seam ({@link MapSelection.snapshot}).
 */
export type SelectionRef =
  | { readonly kind: 'label'; readonly id: string }
  | { readonly kind: 'cell'; readonly coord: Axial }
  | { readonly kind: 'region'; readonly id: string };

/**
 * How a Select gesture folds into the Selection set (CONTEXT.md → Pick, ADR-0017):
 *
 * - `replace` — plain click: replace with the topmost entity; a repeat at the same
 *   coordinate cycles deeper through the stack.
 * - `toggle-top` — Cmd/Ctrl-click: toggle just the topmost entity in or out.
 * - `toggle-stack` — Shift-click: toggle the whole stack (add the missing, or remove
 *   all when the pile is already fully in).
 * - `add-top` / `add-stack` — modifier-held *drag*: add-only counterparts of the
 *   toggles, so sweeping accumulates and re-entering a hex never removes it.
 */
export type SelectMode = 'replace' | 'toggle-top' | 'toggle-stack' | 'add-top' | 'add-stack';

/**
 * The transient Selection — a set of {@link SelectionRef}s over the live document
 * (CONTEXT.md → Selection). Holds the set signal and the click-cycle anchor; every
 * read resolves against the document so the set self-heals member-by-member rather
 * than going stale (issues #28, #35). Neither undone nor persisted itself, though the
 * store's history snapshots and restores it in lockstep with the document
 * ({@link snapshot}/{@link restore}).
 *
 * A plain read-only dependency on the document `Signal`: this module never mutates
 * the map. UI side effects it used to reach for — opening the Inspector, disarming a
 * stale Region brush — live in the store, which projects them from {@link selections}.
 */
export class MapSelection {
  constructor(private readonly doc: Signal<HexMap>) {}

  /**
   * The Selection as a *set* of references, in selection order (ADR-0017). Holds only
   * the references; {@link selections} resolves each against the document, so the set
   * self-heals member-by-member rather than going stale (issues #28, #35).
   */
  private readonly _selections = signal<readonly SelectionRef[]>([]);

  /**
   * The anchor of the per-coordinate selection cycle (CONTEXT.md → Select, ADR-0011):
   * the `coordKey|labelHit` of the running click, or `null`. Repeated clicks at the
   * same anchor descend the candidate stack (wrapping); a different anchor resets to
   * the top. Only the anchor is stored, never an index: the descent position is
   * *derived* each click from where the live selection sits in the freshly-resolved
   * stack (see {@link select}), so a label drop, Hex move, undo, or added/removed
   * candidate can't leave it stale (issues #28, #35).
   */
  private cycleAnchor: string | null = null;

  /**
   * The selection set resolved against the live document so it never goes stale: a
   * cell reads as `feature` or bare `hex`, an erased cell or gone label resolves
   * away. The inspector and renderer read this; the canvas feeds clicks to
   * {@link select} (issue #28).
   */
  readonly selections = computed<Selection[]>(() => {
    const doc = this.doc();
    // Drop any member gone stale — the set self-heals member-by-member (issues #28, #35).
    return this._selections().flatMap((ref) => {
      const resolved = resolveRef(doc, ref);
      return resolved ? [resolved] : [];
    });
  });

  /**
   * The single selected entity, or `null` when zero or many are selected — the
   * "exactly one" view {@link selectedLabel}, {@link selectedRegion}, and the
   * single-Hex drag read. Resolved against the live document, so never stale.
   */
  readonly selection = computed<Selection | null>(() => {
    const all = this.selections();
    return all.length === 1 ? all[0] : null;
  });

  /**
   * The selected {@link Label} from the live document, or `null` when the selection
   * isn't a Label or its id is gone. The inspector binds to this.
   */
  readonly selectedLabel = computed<Label | null>(() => {
    const sel = this.selection();
    if (sel?.kind !== 'label') return null;
    return this.doc().labels.find((l) => l.id === sel.id) ?? null;
  });

  /**
   * The selected {@link Region} from the live document, or `null` when the selection
   * isn't a Region or its id is gone. Peer to {@link selectedLabel} (issue #36).
   */
  readonly selectedRegion = computed<Region | null>(() => {
    const sel = this.selection();
    if (sel?.kind !== 'region') return null;
    return regionById(this.doc(), sel.id) ?? null;
  });

  /**
   * The Entity Link id on the single selected Map element (Hex/Feature/Region),
   * or `null` when nothing single is selected, the selection is a Label (Labels
   * carry no link, CONTEXT.md), or the element has no link. The Inspector's
   * Entity Link control binds to this (issue #76).
   */
  readonly selectedEntityLink = computed<string | null>(() => {
    const sel = this.selection();
    if (!sel) return null;
    const doc = this.doc();
    if (sel.kind === 'hex') return doc.hexes[coordKey(sel.coord)]?.entityId ?? null;
    if (sel.kind === 'feature') {
      return doc.hexes[coordKey(sel.coord)]?.feature?.entityId ?? null;
    }
    if (sel.kind === 'region') return regionById(doc, sel.id)?.entityId ?? null;
    return null;
  });

  /**
   * The current reference set, for the store's undo/redo history to snapshot as an
   * edit's `selectionBefore`/`selectionAfter` (the {@link SelectionRef} is the DTO it
   * carries). Paired with {@link restore}.
   */
  snapshot(): readonly SelectionRef[] {
    return this._selections();
  }

  /**
   * Restore a snapshotted reference set — the undo/redo counterpart to
   * {@link snapshot}, moving the selection back in lockstep with the document. Resets
   * the cycle anchor (it isn't snapshotted, and a fresh cycle after a history step is
   * safe — a stray anchor would descend from the wrong place).
   */
  restore(refs: readonly SelectionRef[]): void {
    this._selections.set(refs);
    this.cycleAnchor = null;
  }

  /**
   * The live Selection partitioned for a move: cell coordinates, label ids, region
   * ids. One place the move paths read the set, so the store's preview and commit
   * can't disagree about what's moving (issue #64).
   */
  partitionForMove(): { hexes: Axial[]; labels: string[]; regions: string[] } {
    const hexes: Axial[] = [];
    const labels: string[] = [];
    const regions: string[] = [];
    for (const ref of this._selections()) {
      if (ref.kind === 'cell') hexes.push(ref.coord);
      else if (ref.kind === 'label') labels.push(ref.id);
      else regions.push(ref.id);
    }
    return { hexes, labels, regions };
  }

  /**
   * Re-point the selection after the document moved by `offset`: each cell ref rides
   * by the offset, region/label refs keep their ids. The cell translation is a
   * bijection, so no duplicates. Called by the store's move commit so the group stays
   * selected on the entities it landed on (issue #64).
   */
  repointByOffset(offset: Axial): void {
    this._selections.set(
      this._selections().map(
        (ref): SelectionRef => (ref.kind === 'cell' ? { kind: 'cell', coord: addAxial(ref.coord, offset) } : ref),
      ),
    );
  }

  /**
   * Select given a click's geometric inputs (issue #28): the hex `coord` and the
   * `labelHit` from `renderer.labelAt` (Label id drawn there, or `null`). Precedence
   * lives here so it stays unit-testable: a Label hit wins, else a painted cell, else
   * a Void with no hit clears (CONTEXT.md → Select, ADR-0010). Returns the resolved
   * {@link Selection} so the caller can branch (e.g. start a label drag).
   */
  select(coord: Axial, labelHit: string | null, mode: SelectMode = 'replace'): Selection | null {
    const stack = this.candidatesAt(coord, labelHit);
    if (mode === 'replace') return this.selectReplace(coord, labelHit, stack);

    // Modifiers fold into the set, not cycle, so forget the cycle anchor (issue #35).
    this.cycleAnchor = null;
    // A modifier on empty space leaves the set untouched; only a *plain* click clears
    // (CONTEXT.md → Pick).
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
    return this.selection();
  }

  /**
   * The plain-click path: replace the set with the topmost entity, cycling deeper on
   * a repeat at the same anchor; empty space clears via {@link deselect}. The descent
   * position is *derived* from where the live selection sits in the freshly-resolved
   * stack — never a stored index — so a label drop, Hex move, undo, or added/removed
   * candidate can't leave it stale (issue #35).
   */
  private selectReplace(coord: Axial, labelHit: string | null, stack: SelectionRef[]): Selection | null {
    if (stack.length === 0) {
      this.deselect();
      return null;
    }
    const anchor = `${coordKey(coord)}|${labelHit ?? ''}`;
    let index = 0;
    if (anchor === this.cycleAnchor) {
      // The cycle runs only on a single-entity selection; a larger set restarts at top.
      const current = this.singleRef();
      const at = current ? stack.findIndex((ref) => sameSelectionRef(ref, current)) : -1;
      if (at !== -1) index = (at + 1) % stack.length;
    }
    this.cycleAnchor = anchor;
    this._selections.set([stack[index]]);
    return this.selection();
  }

  /** The single selection ref when exactly one is selected, else `null` — the cycle's anchor of comparison. */
  private singleRef(): SelectionRef | null {
    const refs = this._selections();
    return refs.length === 1 ? refs[0] : null;
  }

  /**
   * Add each of `refs` if absent, never removing — the accumulating counterpart to
   * {@link toggleRefs} for a modifier-held sweep, so re-entering a selected hex
   * mid-drag leaves it put (ADR-0017).
   */
  private addRefs(refs: SelectionRef[]): void {
    const current = this._selections();
    // Dedup-preserving union; only write when it grew (mergeRefs only appends), so
    // a no-op add stays signal-quiet.
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
   * Toggle a whole stack (Shift-click): remove all when the pile is already fully
   * selected, else add the missing ones — so a second Shift-click clears it back out
   * (ADR-0017).
   */
  private toggleStack(stack: SelectionRef[]): void {
    const current = this._selections();
    // O(1) membership index; the array stays ordered so filter/concat keep selection order.
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
   * The selection candidates under a click, deepest-last: the Label hit, then the
   * painted cell, then every Region containing the coordinate in document order.
   * Feature-vs-Hex is left to {@link selection} to derive (issue #35).
   */
  private candidatesAt(coord: Axial, labelHit: string | null): SelectionRef[] {
    const refs: SelectionRef[] = [];
    if (labelHit !== null) refs.push({ kind: 'label', id: labelHit });
    // Copy the coordinate, never alias: a reused hover object could retarget the selection.
    const key = coordKey(coord);
    if (this.doc().hexes[key]) {
      refs.push({ kind: 'cell', coord: { q: coord.q, r: coord.r } });
    }
    for (const region of this.doc().regions) {
      if (region.hexes[key]) refs.push({ kind: 'region', id: region.id });
    }
    return refs;
  }

  /**
   * Select the Region `id` by id (not a clicked coordinate) — the Regions panel's
   * path and the *only* way to reach an empty Region (no hex to click); routes
   * through the same set as the canvas (ADR-0011). Peer to {@link selectLabel};
   * transient, no undo step. The store's façade wrapper handles opening the Inspector
   * and disarming a stale Region brush.
   */
  selectRegion(id: string): void {
    this._selections.set([{ kind: 'region', id }]);
  }

  /**
   * Fold a marquee box-selection into the set (CONTEXT.md → Marquee, ADR-0017): plain
   * (`additive` false) replaces, Shift/Cmd (`additive` true) adds so boxes accumulate.
   * Regions are never passed — they have no single position. Transient, no undo step.
   */
  marqueeSelect(hexes: Axial[], labelIds: string[], additive: boolean): void {
    const refs = marqueeRefs(hexes, labelIds);
    // Not a click cycle, so forget the cycle anchor (issue #35).
    this.cycleAnchor = null;
    if (additive) this.addRefs(refs);
    else this._selections.set(refs);
  }

  /**
   * The Selection set a marquee {@link marqueeSelect commit} *would* produce, resolved
   * against the live document without mutating. The canvas reads this each drag frame
   * to highlight live, so the box previews exactly what release selects. A plain box
   * previews its own contents; an additive box previews the committed set unioned with
   * it. Pure query — no edit, no signal.
   */
  marqueePreview(hexes: Axial[], labelIds: string[], additive: boolean): Selection[] {
    const refs = marqueeRefs(hexes, labelIds);
    // Additive builds on the committed set (deduped via the same {@link mergeRefs} as
    // the commit); plain shows only the box, since release replaces the set.
    const base = additive ? this._selections() : [];
    const merged = mergeRefs(base, refs);
    // Resolve against the live document, dropping stale members (as {@link selections}).
    const doc = this.doc();
    return merged.flatMap((ref) => {
      const resolved = resolveRef(doc, ref);
      return resolved ? [resolved] : [];
    });
  }

  /** Select the Label `id` for editing in the inspector, or `null` to clear it. */
  selectLabel(id: string | null): void {
    if (id === null) this.deselect();
    else this._selections.set([{ kind: 'label', id }]);
  }

  /**
   * Clear the selection. The one canonical clear every path routes through: Escape
   * (issue #30), the teardown paths, and {@link select} landing on Void. Forgets the
   * cycle so a later re-select starts at the top of the stack (issue #35).
   */
  deselect(): void {
    this._selections.set([]);
    this.cycleAnchor = null;
  }

  /**
   * Drop every member matching `match`, leaving the rest. Emptying the set runs the
   * {@link deselect} teardown; otherwise the smaller set stays. The store's
   * single-member delete paths route their cleanup through here so removing one entity
   * never strands the set.
   */
  dropWhere(match: (ref: SelectionRef) => boolean): void {
    const remaining = this._selections().filter((ref) => !match(ref));
    if (remaining.length === this._selections().length) return;
    if (remaining.length === 0) this.deselect();
    else this._selections.set(remaining);
  }
}

/**
 * Resolve one {@link SelectionRef} against the live document into the
 * {@link Selection} it denotes, or `null` when stale (label/region id gone, cell
 * erased). A cell reads as a Feature when its hex carries one, else a bare Hex.
 * The single place ref→Selection self-healing lives (issue #28).
 */
function resolveRef(doc: HexMap, ref: SelectionRef): Selection | null {
  if (ref.kind === 'label') {
    return doc.labels.some((l) => l.id === ref.id) ? { kind: 'label', id: ref.id } : null;
  }
  if (ref.kind === 'region') {
    return regionById(doc, ref.id) ? { kind: 'region', id: ref.id } : null;
  }
  const hex = doc.hexes[coordKey(ref.coord)];
  if (!hex) return null;
  return hex.feature ? { kind: 'feature', coord: ref.coord } : { kind: 'hex', coord: ref.coord };
}

/**
 * Whether two refs point at the same entity (cell by coordinate, label/region by
 * id). Lets {@link MapSelection.select} locate the live selection in a resolved stack
 * to derive the cycle position, rather than tracking an index (issue #35).
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
 * Build the {@link SelectionRef}s a marquee box denotes from `hexes`/`labelIds`
 * (CONTEXT.md → Marquee): a cell ref per coordinate, a label ref per id. Shared by
 * {@link MapSelection.marqueeSelect} and {@link MapSelection.marqueePreview} so the
 * preview can't disagree with the commit. Coordinates are copied, never aliased.
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
 * Append `refs` to `base`, skipping any already present (by {@link refKey}) — the
 * dedup-preserving union shared by {@link MapSelection.addRefs} and
 * {@link MapSelection.marqueePreview} so the preview can't disagree with the commit.
 * Returns a fresh array; `base` is unmutated, order preserved, new members appended.
 */
function mergeRefs(base: readonly SelectionRef[], refs: readonly SelectionRef[]): SelectionRef[] {
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

/**
 * A stable string key for a {@link SelectionRef}, consistent with
 * {@link sameSelectionRef} (same key iff same entity). Lets membership tests build
 * an O(1) `Set` index rather than rescanning per swept hex (quadratic over a drag).
 */
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
