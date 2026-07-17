import { computed, signal, Signal } from '@angular/core';
import { addAxial, Axial, coordKey, HexMap, Label, Region, regionById } from '@hexly/plugin-hexmap';

/**
 * One selected entity (CONTEXT.md → Selection): a Label or Region by id, or a Feature /
 * Hex by coordinate. The Selection is a *set* of these ({@link MapSelection.selections});
 * {@link MapSelection.selection} is the "exactly one" view. A click resolves a
 * per-coordinate stack — `Label → Feature → Hex → each containing Region (document
 * order)`; see {@link MapSelection.select}.
 */
export type Selection =
  | { readonly kind: 'label'; readonly id: string }
  | { readonly kind: 'feature'; readonly coord: Axial }
  | { readonly kind: 'hex'; readonly coord: Axial }
  | { readonly kind: 'region'; readonly id: string };

/**
 * The internal selection reference the module holds: a Label or Region by id, or a cell
 * by coordinate. Whether a cell reads as a Feature or bare Hex, and whether a Region
 * still exists, are *derived* from the live document (see {@link MapSelection.selection}).
 * Also the DTO the store's undo/redo history carries ({@link MapSelection.snapshot}).
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
 * (CONTEXT.md → Selection). Neither undone nor persisted itself, though the store's
 * history snapshots and restores it in lockstep with the document
 * ({@link snapshot}/{@link restore}). Read-only on the document `Signal`: this module
 * never mutates the map.
 */
export class MapSelection {
  constructor(private readonly doc: Signal<HexMap>) {}

  /** The Selection as references, in selection order; {@link selections} resolves them. */
  private readonly _selections = signal<readonly SelectionRef[]>([]);

  /**
   * The anchor of the per-coordinate selection cycle: the `coordKey|labelHit` of the
   * running click, or `null`. Repeated clicks at the same anchor descend the candidate
   * stack (wrapping); a different anchor resets to the top. Only the anchor is stored,
   * never an index — the descent position is *derived* each click from where the live
   * selection sits in the freshly-resolved stack (see {@link select}), so a label drop,
   * Hex move, undo, or added/removed candidate can't leave it stale.
   */
  private cycleAnchor: string | null = null;

  /**
   * The selection set resolved against the live document: a cell reads as `feature` or
   * bare `hex`; an erased cell or gone label resolves away.
   */
  readonly selections = computed<Selection[]>(() => {
    const doc = this.doc();
    return this._selections().flatMap((ref) => {
      const resolved = resolveRef(doc, ref);
      return resolved ? [resolved] : [];
    });
  });

  /** The single selected entity, or `null` when zero or many are selected. */
  readonly selection = computed<Selection | null>(() => {
    const all = this.selections();
    return all.length === 1 ? all[0] : null;
  });

  /** The selected {@link Label}, or `null` when the selection isn't a Label or its id is gone. */
  readonly selectedLabel = computed<Label | null>(() => {
    const sel = this.selection();
    if (sel?.kind !== 'label') return null;
    return this.doc().labels.find((l) => l.id === sel.id) ?? null;
  });

  /** The selected {@link Region}, or `null` when the selection isn't a Region or its id is gone. */
  readonly selectedRegion = computed<Region | null>(() => {
    const sel = this.selection();
    if (sel?.kind !== 'region') return null;
    return regionById(this.doc(), sel.id) ?? null;
  });

  /**
   * The Entity Link id on the single selected Map element (Hex/Feature/Region), or `null`
   * when nothing single is selected, the selection is a Label (Labels carry no link,
   * CONTEXT.md), or the element has no link.
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
   * The current reference set, for the store's undo/redo history to snapshot as an edit's
   * `selectionBefore`/`selectionAfter`. Paired with {@link restore}.
   */
  snapshot(): readonly SelectionRef[] {
    return this._selections();
  }

  /**
   * Restore a snapshotted reference set ({@link snapshot}). Resets the cycle anchor: it
   * isn't snapshotted, and a stray anchor would descend from the wrong place.
   */
  restore(refs: readonly SelectionRef[]): void {
    this._selections.set(refs);
    this.cycleAnchor = null;
  }

  /** The live Selection partitioned for a move: cell coordinates, label ids, region ids. */
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
   * Re-point the selection after the document moved by `offset`: each cell ref rides by
   * the offset, region/label refs keep their ids. The cell translation is a bijection, so
   * no duplicates.
   */
  repointByOffset(offset: Axial): void {
    this._selections.set(
      this._selections().map(
        (ref): SelectionRef => (ref.kind === 'cell' ? { kind: 'cell', coord: addAxial(ref.coord, offset) } : ref),
      ),
    );
  }

  /**
   * Select given a click's geometric inputs: the hex `coord` and the `labelHit` from
   * `renderer.labelAt` (Label id drawn there, or `null`). Precedence: a Label hit wins,
   * else a painted cell, else a Void with no hit clears (CONTEXT.md → Select). Returns
   * the resolved {@link Selection} so the caller can branch (e.g. start a label drag).
   */
  select(coord: Axial, labelHit: string | null, mode: SelectMode = 'replace'): Selection | null {
    const stack = this.candidatesAt(coord, labelHit);
    if (mode === 'replace') return this.selectReplace(coord, labelHit, stack);

    // Modifiers fold into the set, not cycle, so forget the cycle anchor.
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
   * The plain-click path: replace the set with the topmost entity, cycling deeper on a
   * repeat at the same anchor; empty space clears via {@link deselect}. The descent
   * position is *derived* from where the live selection sits in the freshly-resolved
   * stack — never a stored index (see {@link cycleAnchor}).
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
   * Add each of `refs` if absent, never removing: re-entering a selected hex mid-sweep
   * leaves it put.
   */
  private addRefs(refs: SelectionRef[]): void {
    const current = this._selections();
    // mergeRefs only appends, so only write when it grew — a no-op add stays signal-quiet.
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
   * Toggle a whole stack: remove all when the pile is already fully selected, else add
   * the missing ones.
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
   * The selection candidates under a click, deepest-last: the Label hit, then the painted
   * cell, then every Region containing the coordinate in document order. Feature-vs-Hex is
   * left to {@link selection} to derive.
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
   * Select the Region `id` by id (not a clicked coordinate) — the *only* way to reach an
   * empty Region, which has no hex to click. Transient, no undo step.
   */
  selectRegion(id: string): void {
    this._selections.set([{ kind: 'region', id }]);
  }

  /**
   * Fold a marquee box-selection into the set (CONTEXT.md → Marquee): plain
   * (`additive` false) replaces, Shift/Cmd (`additive` true) adds so boxes accumulate.
   * Regions are never passed — they have no single position. Transient, no undo step.
   */
  marqueeSelect(hexes: Axial[], labelIds: string[], additive: boolean): void {
    const refs = marqueeRefs(hexes, labelIds);
    // Not a click cycle, so forget the cycle anchor.
    this.cycleAnchor = null;
    if (additive) this.addRefs(refs);
    else this._selections.set(refs);
  }

  /**
   * The Selection set a marquee {@link marqueeSelect commit} *would* produce, resolved
   * against the live document. A plain box previews its own contents; an additive box
   * previews the committed set unioned with it. Pure query — no edit, no signal write.
   */
  marqueePreview(hexes: Axial[], labelIds: string[], additive: boolean): Selection[] {
    const refs = marqueeRefs(hexes, labelIds);
    const base = additive ? this._selections() : [];
    const merged = mergeRefs(base, refs);
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
   * Clear the selection. The one canonical clear every path routes through (Escape, the
   * teardown paths, {@link select} landing on Void); forgets the cycle anchor, so a later
   * re-select starts at the top of the stack.
   */
  deselect(): void {
    this._selections.set([]);
    this.cycleAnchor = null;
  }

  /**
   * Drop every member matching `match`, leaving the rest. Emptying the set runs the
   * {@link deselect} teardown; otherwise the smaller set stays.
   */
  dropWhere(match: (ref: SelectionRef) => boolean): void {
    const remaining = this._selections().filter((ref) => !match(ref));
    if (remaining.length === this._selections().length) return;
    if (remaining.length === 0) this.deselect();
    else this._selections.set(remaining);
  }
}

/**
 * Resolve one {@link SelectionRef} against the live document into the {@link Selection} it
 * denotes, or `null` when stale (label/region id gone, cell erased). A cell reads as a
 * Feature when its hex carries one, else a bare Hex.
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

/** Whether two refs point at the same entity: cell by coordinate, label/region by id. */
function sameSelectionRef(a: SelectionRef, b: SelectionRef): boolean {
  if (a.kind === 'cell' && b.kind === 'cell') {
    return coordKey(a.coord) === coordKey(b.coord);
  }
  if (a.kind === 'label' && b.kind === 'label') return a.id === b.id;
  if (a.kind === 'region' && b.kind === 'region') return a.id === b.id;
  return false;
}

/**
 * Build the {@link SelectionRef}s a marquee box denotes: a cell ref per coordinate, a
 * label ref per id. Coordinates are copied, never aliased.
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
 * Append `refs` to `base`, skipping any already present (by {@link refKey}). Returns a
 * fresh array; `base` is unmutated, order preserved, new members appended.
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
 * A stable string key for a {@link SelectionRef}, consistent with {@link sameSelectionRef}
 * (same key iff same entity) — lets membership tests use an O(1) `Set` index.
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
