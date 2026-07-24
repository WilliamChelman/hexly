import { Injectable } from '@nestjs/common';
import { AssetStats, imageStatsSchema, orientationOf } from '@hexly/plugin-asset';
import sharp from 'sharp';

/** The longest-edge cap of a minted thumbnail (ADR-0065): a grid renders this, never the raw bytes. */
export const THUMBNAIL_MAX_EDGE = 400;

/**
 * What an extractor derives from an Asset's bytes at mint (ADR-0065): the mechanical {@link AssetStats}
 * written into the asset-ref, and a lightweight thumbnail stored beside the bytes. Either is `null` when
 * the extractor could not produce it — extraction is never a gate on the upload.
 */
export interface AssetExtraction {
  readonly stats: AssetStats | null;
  readonly thumbnail: Buffer | null;
}

/** The empty extraction — what a mime with no registered extractor, or a failed one, yields. */
const NO_EXTRACTION: AssetExtraction = { stats: null, thumbnail: null };

/** An internal extractor (ADR-0065): derives stats and a thumbnail from bytes it understands, or throws. */
type Extractor = (bytes: Uint8Array) => Promise<AssetExtraction>;

/**
 * Write-time mechanical extraction of **Asset Stats** and thumbnails (ADR-0065). An **internal registry**
 * keyed by mime prefix — *not* a Plugin contribution point yet — dispatches bytes to an extractor; today
 * the one entry is a sharp-backed `image/` extractor. Extraction is best-effort: bytes no extractor
 * recognises, or that its extractor cannot parse, yield {@link NO_EXTRACTION} (`stats: null`, no thumbnail)
 * rather than failing the mint. The interpretive tier (AI description/tags) is a later async plugin seam.
 */
@Injectable()
export class AssetExtractionService {
  /** Mime-prefix → extractor. Longest-prefix-free: the prefixes are disjoint, matched by `startsWith`. */
  private readonly extractors: ReadonlyMap<string, Extractor> = new Map([['image/', extractImage]]);

  /**
   * Extract stats and a thumbnail for `bytes` of content type `mime` (ADR-0065). Never throws: an
   * unregistered mime or an extractor failure (unparseable bytes) resolves to {@link NO_EXTRACTION}, so
   * the upload succeeds statless. Async because the image extractor (sharp/libvips) has no sync API — the
   * caller runs it *before* the synchronous mint transaction.
   */
  async extract(mime: string, bytes: Uint8Array): Promise<AssetExtraction> {
    const extractor = this.extractorFor(mime);
    if (!extractor) return NO_EXTRACTION;
    try {
      return await extractor(bytes);
    } catch {
      // Non-fatal (ADR-0065): sharp throwing on bytes it cannot parse is a statless Asset, not a failed upload.
      return NO_EXTRACTION;
    }
  }

  private extractorFor(mime: string): Extractor | undefined {
    for (const [prefix, extractor] of this.extractors) if (mime.startsWith(prefix)) return extractor;
    return undefined;
  }
}

/**
 * The sharp-backed `image/*` extractor (ADR-0065): pixel dimensions and orientation, the dominant color as
 * a `#rrggbb` hex, and a ~400px-longest-edge WebP thumbnail (never upscaled). Throws on bytes sharp cannot
 * parse — the registry catches it into a statless mint. Metadata and color come from one decode each; the
 * thumbnail from a second pass, so a failure to resize a valid image still surfaces as no-extraction.
 */
async function extractImage(bytes: Uint8Array): Promise<AssetExtraction> {
  const image = sharp(bytes);
  const metadata = await image.metadata();
  const { width, height } = metadata;
  if (!width || !height) throw new Error('Image has no dimensions');

  const { dominant } = await image.stats();
  const stats = imageStatsSchema.parse({
    width,
    height,
    orientation: orientationOf(width, height),
    dominantColor: toHex(dominant),
  });

  const thumbnail = await sharp(bytes)
    .resize(THUMBNAIL_MAX_EDGE, THUMBNAIL_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    .webp()
    .toBuffer();

  return { stats, thumbnail };
}

/** A sharp dominant `{ r, g, b }` (0–255) as a lowercase `#rrggbb` hex — the raw color the harvest buckets. */
function toHex(color: { r: number; g: number; b: number }): string {
  const channel = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}
