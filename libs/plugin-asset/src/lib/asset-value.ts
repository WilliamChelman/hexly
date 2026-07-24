/**
 * The **asset-ref** value (CONTEXT.md → Asset, Asset Stats; ADR-0065): the content-addressed handle an
 * Asset Entity carries at the `core.field.asset` key — the bytes' `hash`, the pinned `ext` (so the
 * capability URL never moves on a rename), the `mime` and `size`, and the mechanical **Asset Stats**.
 *
 * `stats` is `null` when no extractor ran (an upload whose bytes sharp cannot parse, a non-image kind);
 * extraction is never a gate on the upload. Framework-free, so both the API's mint path — where the
 * sharp-backed extractor fills it — and the web's picker read the same shape.
 */

import * as z from 'zod';
import { assetUrl } from '@hexly/domain';
import { ORIENTATIONS } from './asset-stats';

/**
 * The mechanical **Asset Stats** derived from an Asset's bytes (CONTEXT.md → Asset Stats). A `passthrough`
 * bag keyed by the mime the extractor recognised — the image extractor writes {@link imageStatsSchema},
 * a later kind writes its own — so the ref reads forward-only whatever an extractor wrote, and the harvest
 * narrows the slice it needs. `passthrough` keeps a future kind's keys through a re-parse of an old ref.
 */
export const assetStatsSchema = z.looseObject({
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  orientation: z.enum(ORIENTATIONS).optional(),
  dominantColor: z.string().optional(),
});

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
