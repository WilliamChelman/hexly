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
    if (sel.gte) tokens.push(`${key}:gte:${sel.gte}`);
    if (sel.lte) tokens.push(`${key}:lte:${sel.lte}`);
  }
  return tokens;
}

/** Fold the repeated `field` params back into the per-key {@link FieldSelection} record. */
export function fieldsFromTokens(tokens: readonly string[]): Record<string, FieldSelection> {
  const out: Record<string, { values: string[]; gte?: string; lte?: string }> = {};
  for (const f of parseFieldFilters(tokens)) {
    // The rail has no control for an exclusion yet (ADR-0081, #422), so `neq` is left out rather than
    // falling through to `lte` — a bound is not what it says.
    if (f.op === 'neq') continue;
    const sel = (out[f.key] ??= { values: [] });
    if (f.op === 'eq') sel.values.push(f.value);
    else if (f.op === 'gte') sel.gte = f.value;
    else sel.lte = f.value;
  }
  return out;
}

/** Drop a Field key once its selection is empty, so `hasFilters`/the URL never carry a dead entry. */
export function pruneField(sel: FieldSelection): FieldSelection | undefined {
  return isFieldSelectionEmpty(sel) ? undefined : sel;
}
