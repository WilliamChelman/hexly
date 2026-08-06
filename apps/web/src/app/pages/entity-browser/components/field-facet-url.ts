import { parseFieldFilters } from '@hexly/domain';
import { FieldSelection, isFieldSelectionEmpty } from './facet-rail.component';

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
    if (sel.gte) tokens.push(`${key}:gte:${sel.gte}`);
    if (sel.lte) tokens.push(`${key}:lte:${sel.lte}`);
  }
  return tokens;
}

/**
 * Fold the repeated `field` params back into the per-key {@link FieldSelection} record. `canExclude`
 * mirrors the rail input of the same name: a browse that renders no exclude control drops a `neq`
 * rather than filtering by a veto the reader has no way to release (ADR-0081). Never folded
 * into `lte` either way — a bound is not what it says.
 */
export function fieldsFromTokens(tokens: readonly string[], canExclude = false): Record<string, FieldSelection> {
  const out: Record<string, { values: string[]; excluded: string[]; gte?: string; lte?: string }> = {};
  for (const f of parseFieldFilters(tokens)) {
    if (f.op === 'neq' && !canExclude) continue;
    const sel = (out[f.key] ??= { values: [], excluded: [] });
    if (f.op === 'eq') sel.values.push(f.value);
    else if (f.op === 'neq') sel.excluded.push(f.value);
    else if (f.op === 'gte') sel.gte = f.value;
    else sel.lte = f.value;
  }
  return Object.fromEntries(Object.entries(out).map(([key, sel]) => [key, canonicalField(sel)]));
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
  const out: { values: string[]; excluded?: string[]; gte?: string; lte?: string } = {
    values: [...(sel.values ?? [])],
  };
  if (sel.excluded?.length) out.excluded = [...sel.excluded];
  if (sel.gte) out.gte = sel.gte;
  if (sel.lte) out.lte = sel.lte;
  return out;
}
