import { FieldFilter, FieldFilterOp, parseFieldFilters } from '@hexly/domain';
import {
  FieldBoundOp,
  FieldRangeBound,
  FieldRangeSelection,
  FieldSelection,
  isFieldSelectionEmpty,
} from './facet-rail.component';

/**
 * The **Field** Facet selections' round trip through the `field` query param, shared by every browse
 * that drives the Facet rail — the **Entity Browser**, the **Asset Browser** and the **Compendium
 * browse**. One codec, so a filter set survives a link between browses and a fix lands in all three.
 */

/** Serialize the active Field selections to the repeated `key:op:value` tokens the API + URL speak. */
export function fieldTokens(fields: Readonly<Record<string, FieldSelection>>): string[] {
  const tokens: string[] = [];
  for (const [key, sel] of Object.entries(fields)) {
    for (const v of sel.values ?? []) tokens.push(`${key}:eq:${v}`);
    // The excluding half rides the same param as its includes (ADR-0081): this grammar already
    // carries an operator, so a Field needs no second param to say "everything except".
    for (const v of sel.excluded ?? []) tokens.push(`${key}:neq:${v}`);
    // A bound is written with the op it was named with: `>5` serialised as `gte` would let in exactly
    // the row the caller asked to leave out (ADR-0082).
    if (sel.gte) tokens.push(`${key}:${sel.gte.op}:${sel.gte.value}`);
    if (sel.lte) tokens.push(`${key}:${sel.lte.op}:${sel.lte.value}`);
  }
  return tokens;
}

/**
 * Fold the repeated `field` params back into the per-key {@link FieldSelection} record. A `neq` is kept
 * as the exclusion it is — every browse driving this rail renders the exclude control (ADR-0081), so
 * there is no reader who could not release it — and never folded into `lte`, which is not what it says.
 */
export function fieldsFromTokens(tokens: readonly string[]): Record<string, FieldSelection> {
  return foldFieldFilters(parseFieldFilters(tokens));
}

/**
 * Fold `key`/`op`/`value` filters into the per-key {@link FieldSelection} record — the one place the
 * op→slot mapping lives, shared by the URL codec above and the **Facet Token** parse (ADR-0082), which
 * speaks the same filters from a typed `$key:value`.
 */
export function foldFieldFilters(filters: readonly FieldFilter[]): Record<string, FieldSelection> {
  const out: Record<string, MutableSelection> = {};
  for (const f of filters) {
    const sel = (out[f.key] ??= { values: [], excluded: [] });
    if (f.op === 'eq') sel.values.push(f.value);
    else if (f.op === 'neq') sel.excluded.push(f.value);
    // Everything else is a bound, and keeps the op that wrote it — the input it fills is a rendering
    // question, which {@link boundOf} answers, and never the filter's meaning.
    else sel[boundOf(f.op)] = { value: f.value, op: f.op };
  }
  return Object.fromEntries(Object.entries(out).map(([key, sel]) => [key, canonicalField(sel)]));
}

/**
 * Which of a range row's two inputs an op fills, or `undefined` for a membership op, which fills
 * neither. A strict bound (`$cr:>5`, ADR-0082) lands in its inclusive twin's input: the rail offers two
 * bounds, not four. One mapping, read by the fold that renders a bound and by the ownership that makes
 * it readonly — divergence there would mark one input and edit the other.
 */
export function boundOf(op: FieldBoundOp): FieldRangeBound;
export function boundOf(op: FieldFilterOp): FieldRangeBound | undefined;
export function boundOf(op: FieldFilterOp): FieldRangeBound | undefined {
  if (op === 'gte' || op === 'gt') return 'gte';
  if (op === 'lte' || op === 'lt') return 'lte';
  return undefined;
}

/** A selection under construction — the fold fills it in place, {@link canonicalField} freezes it. */
interface MutableSelection {
  values: string[];
  excluded: string[];
  gte?: FieldRangeSelection;
  lte?: FieldRangeSelection;
}

/** Drop a Field key once its selection is empty, so `hasFilters`/the URL never carry a dead entry. */
export function pruneField(sel: FieldSelection): FieldSelection | undefined {
  return isFieldSelectionEmpty(sel) ? undefined : canonicalField(sel);
}

/**
 * One canonical shape for a Field selection — same keys, same order, empties dropped — on both sides
 * of the URL round trip. The active-facet signals compare by JSON, so a decoded selection that
 * merely _spells_ itself differently from the toggle that caused it would read as a change and
 * refetch a second time.
 */
function canonicalField(sel: FieldSelection): FieldSelection {
  const out: Partial<MutableSelection> & { values: string[] } = { values: [...(sel.values ?? [])] };
  if (sel.excluded?.length) out.excluded = [...sel.excluded];
  if (sel.gte) out.gte = { value: sel.gte.value, op: sel.gte.op };
  if (sel.lte) out.lte = { value: sel.lte.value, op: sel.lte.op };
  return out;
}
