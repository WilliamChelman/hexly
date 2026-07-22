/**
 * The **asset-ref** value (CONTEXT.md → Asset, Asset Stats; ADR-0065): the content-addressed handle an
 * Asset Entity carries at the `core.field.asset` key — the bytes' `hash`, the pinned `ext` (so the
 * capability URL never moves on a rename), the `mime` and `size`, and the mechanical **Asset Stats**.
 *
 * `stats` is `null` for now — extraction (sharp-derived dimensions/orientation/dominant color) lands in
 * its own ticket. Framework-free, so both the API's mint path and the web's picker read the same shape.
 */

import * as z from 'zod';
import { assetUrl } from '@hexly/domain';

/**
 * The mechanical **Asset Stats** derived from an Asset's bytes (CONTEXT.md → Asset Stats). An open bag
 * for now — the extractor registry that fills it is a later ticket — so this skeleton always mints
 * `null` and reads whatever a future extractor wrote back forward-only.
 */
export const assetStatsSchema = z.record(z.string(), z.unknown());

export type AssetStats = z.infer<typeof assetStatsSchema>;

/**
 * The asset-ref value. `ext` carries its own leading dot (`'.png'`), pinned at mint so the served
 * {@link assetUrl} is stable across renames (ADR-0065). `stats` is `null` when no extractor has run.
 */
export const assetValueSchema = z.object({
  hash: z.string().regex(/^[0-9a-f]{64}$/, 'A content hash is a lowercase sha256 hex digest'),
  ext: z.string(),
  mime: z.string(),
  size: z.number().int().nonnegative(),
  stats: assetStatsSchema.nullable(),
});

export type AssetValue = z.infer<typeof assetValueSchema>;

/** The served capability {@link assetUrl} an asset-ref names, given the Asset's World. */
export function assetValueUrl(worldId: string, value: AssetValue): string {
  return assetUrl(worldId, value.hash, value.ext);
}
