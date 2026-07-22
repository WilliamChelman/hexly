/**
 * `core.datatype.asset` — the **asset-ref** as a **Structured Data Type** (CONTEXT.md → Asset, ADR-0065).
 * `core.type.asset` declares it at the `core.field.asset` key, so an Asset Entity's content-address handle
 * lives in the one EntityDocument map beside its prose.
 *
 * It harvests no text, no edges, and no facets yet (facet dimensions from **Asset Stats** land with the
 * extractor ticket). It alone owns bytes, so it is the one data-type that {@link StructuredDataType.harvestAssetHash}
 * — the content `hash` mirrored to the derived `(worldId, hash) → entity` dedup index at the write choke point.
 *
 * Its **Vault Projection** is `omit`: the asset-ref is not serialized into a Markdown file — the bytes ride
 * the export's binary passthrough under the Entity's `name + ext` (ADR-0033/ADR-0065), and re-import re-mints
 * the ref by hash. The `core.` namespace names who owns the vocabulary, not which lib ships it (ADR-0050).
 */

import { defineField, defineStructuredDataType, type Field, type StructuredDataTypeId } from '@hexly/domain';
import { assetValueSchema, type AssetValue } from './asset-value';

/** The `namespace.id` kind naming the asset-ref data-type — what marks the `core.field.asset` Field structured. */
export const CORE_ASSET: StructuredDataTypeId = 'core.datatype.asset';

/** A fresh, empty asset-ref — a placeholder the mint path always overwrites with the stored bytes' ref. */
export function emptyAssetValue(): AssetValue {
  return { hash: '', ext: '', mime: '', size: 0, stats: null };
}

export const ASSET_DATA_TYPE = defineStructuredDataType({
  id: CORE_ASSET,
  valueSchema: assetValueSchema,
  empty: emptyAssetValue,
  // The one data-type that owns bytes: its content hash keys the per-World dedup index (ADR-0065). An
  // empty placeholder ref (no hash yet) contributes nothing.
  harvestAssetHash: (value: AssetValue) => value.hash || null,
  // The ref is derived from the bytes, not authored prose: it is written nowhere in the Markdown export;
  // the bytes are the export's binary passthrough, re-minting the ref by hash on re-import.
  vault: { slot: 'omit' },
});

/** The asset-ref Field's namespaced identifier — its `id`, and (ADR-0056) the EntityDocument key it lenses. */
export const ASSET_FIELD_ID = 'core.field.asset';

/**
 * The asset-ref Field `core.type.asset` references (ADR-0054): the EntityDocument slice carrying the bytes'
 * content-address handle. Not `required` — a bare Asset opens on an empty ref until the mint fills it — and
 * never facetable, since a document has no discrete values to count (its Stats harvest facets instead, later).
 */
export const ASSET_FIELD: Field = defineField({
  id: ASSET_FIELD_ID,
  // The untranslated fallback the API's available-types list reports; the web resolves `labelKey`.
  label: 'Asset',
  labelKey: 'asset.view.asset',
  dataType: { kind: CORE_ASSET },
  required: false,
  facetable: false,
});
