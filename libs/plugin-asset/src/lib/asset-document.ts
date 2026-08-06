/**
 * Reading an Asset Entity's asset-ref out of its **Entity Document** (ADR-0065). Framework-free, so the
 * API's list/export/dedup paths and the web's picker share one reader — a plain document key, forward-only.
 */

import { EntityDocument } from '@hexly/domain';
import { ASSET_FIELD_ID } from './asset-data-type';
import { assetValueSchema, type AssetValue } from './asset-value';

/**
 * The asset-ref value an Asset Entity carries at the `core.field.asset` key, or `null` — forward-only, so a
 * document this build cannot parse (a placeholder ref, a foreign value) reads as absent rather than throwing.
 */
export function readAssetValue(doc: EntityDocument): AssetValue | null {
  const parsed = assetValueSchema.safeParse(doc[ASSET_FIELD_ID]);
  return parsed.success && parsed.data.hash ? parsed.data : null;
}
