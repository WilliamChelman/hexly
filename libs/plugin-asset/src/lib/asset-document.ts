/**
 * Reading an Asset Entity's asset-ref out of its **Entity Document** (ADR-0065). Framework-free, so the
 * API's list/export/dedup paths and the web's picker share one reader — a plain document key, forward-only.
 */

import { AssetSummary, EntityDocument } from '@hexly/domain';
import { ASSET_FIELD_ID } from './asset-data-type';
import { assetValueSchema, assetValueUrl, type AssetValue } from './asset-value';

/**
 * The asset-ref value an Asset Entity carries at the `core.field.asset` key, or `null` — forward-only, so a
 * document this build cannot parse (a placeholder ref, a foreign value) reads as absent rather than throwing.
 */
export function readAssetValue(doc: EntityDocument): AssetValue | null {
  const parsed = assetValueSchema.safeParse(doc[ASSET_FIELD_ID]);
  return parsed.success && parsed.data.hash ? parsed.data : null;
}

/**
 * An Asset Entity as the picker sees it (ADR-0034/ADR-0065): its served capability {@link assetValueUrl},
 * the human-readable `name + ext` an author picks by, and the `mime`/`size` from the ref. `name` is the
 * Entity's name (the filename stem at mint), so a rename relabels the picker row but never moves the URL.
 */
export function assetSummaryOf(worldId: string, name: string, value: AssetValue): AssetSummary {
  return {
    url: assetValueUrl(worldId, value),
    originalFilename: `${name}${value.ext}`,
    mime: value.mime,
    size: value.size,
  };
}
