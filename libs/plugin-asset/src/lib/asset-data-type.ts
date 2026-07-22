/**
 * `core.datatype.asset` — the **asset-ref** as a **Structured Data Type** (CONTEXT.md → Asset, ADR-0065).
 * `core.type.asset` declares it at the `core.field.asset` key, so an Asset Entity's content-address handle
 * lives in the one EntityDocument map beside its prose.
 *
 * It harvests three **Facet** dimensions from the asset-ref (ADR-0055/0065): `kind` (from the mime), and —
 * from the **Asset Stats** an extractor wrote — `orientation` and a bucketed named `hue` (the dominant color
 * is stored as a value in stats; the facet is the bucket, see {@link bucketHue}). It carries no text and no
 * edges. It alone owns bytes, so it is the one data-type that {@link StructuredDataType.harvestAssetHash}
 * — the content `hash` mirrored to the derived `(worldId, hash) → entity` dedup index at the write choke point.
 *
 * Its **Vault Projection** is `omit`: the asset-ref is not serialized into a Markdown file — the bytes ride
 * the export's binary passthrough under the Entity's `name + ext` (ADR-0033/ADR-0065), and re-import re-mints
 * the ref by hash. The `core.` namespace names who owns the vocabulary, not which lib ships it (ADR-0050).
 */

import {
  defineField,
  defineStructuredDataType,
  type Field,
  type HarvestedFacet,
  type StructuredDataTypeId,
} from '@hexly/domain';
import { assetValueSchema, type AssetValue } from './asset-value';
import { ASSET_KINDS, assetKind, bucketHue, HUE_BUCKETS, ORIENTATIONS } from './asset-stats';

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
  // The mechanical facets (ADR-0055/0065): `kind` off the mime (always present), and — when an extractor
  // wrote Asset Stats — `orientation` and the bucketed `hue`. Enum dimensions, so the rail toggles values.
  facetDimensions: [
    { key: 'kind', labelKey: 'asset.facet.kind', dataType: { kind: 'enum', options: [...ASSET_KINDS] } },
    {
      key: 'orientation',
      labelKey: 'asset.facet.orientation',
      dataType: { kind: 'enum', options: [...ORIENTATIONS] },
    },
    { key: 'hue', labelKey: 'asset.facet.hue', dataType: { kind: 'enum', options: [...HUE_BUCKETS] } },
  ],
  harvestFacets: (value: AssetValue): HarvestedFacet[] => {
    // A bare, pre-mint placeholder ref (no bytes yet) has no real mime to bucket — it harvests nothing,
    // like its hash. Mint fills the ref in the same write, so an Asset at rest always carries real facets.
    if (!value.hash) return [];
    const rows: HarvestedFacet[] = [{ key: 'kind', value: assetKind(value.mime), num: null }];
    const stats = value.stats;
    if (stats?.orientation) rows.push({ key: 'orientation', value: stats.orientation, num: null });
    if (typeof stats?.dominantColor === 'string') {
      const hue = bucketHue(stats.dominantColor);
      if (hue) rows.push({ key: 'hue', value: hue, num: null });
    }
    return rows;
  },
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
