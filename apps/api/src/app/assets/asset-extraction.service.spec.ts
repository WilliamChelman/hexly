import sharp from 'sharp';
import { AssetExtractionService } from './asset-extraction.service';

describe('AssetExtractionService (write-time mechanical extraction, ADR-0065)', () => {
  const service = new AssetExtractionService();

  /** A real, tiny solid-color image sharp can parse. */
  function image(width: number, height: number, rgb: { r: number; g: number; b: number }): Promise<Buffer> {
    return sharp({ create: { width, height, channels: 3, background: rgb } })
      .png()
      .toBuffer();
  }

  it('derives dimensions, orientation, and a #rrggbb dominant color from an image', async () => {
    const bytes = await image(20, 8, { r: 24, g: 200, b: 24 });
    const { stats, thumbnail } = await service.extract('image/png', bytes);

    expect(stats).toEqual({
      width: 20,
      height: 8,
      orientation: 'landscape',
      dominantColor: expect.stringMatching(/^#[0-9a-f]{6}$/),
    });
    // A ~400px WebP thumbnail is minted in the same pass.
    expect(thumbnail).toBeInstanceOf(Buffer);
    expect((await sharp(thumbnail as Buffer).metadata()).format).toBe('webp');
  });

  it('reads a portrait image as portrait, never upscaling a tiny source', async () => {
    const bytes = await image(8, 20, { r: 24, g: 24, b: 200 });
    const { stats, thumbnail } = await service.extract('image/png', bytes);

    expect(stats?.orientation).toBe('portrait');
    // withoutEnlargement: the 8×20 source is smaller than the 400px cap, so the thumb keeps its size.
    expect((await sharp(thumbnail as Buffer).metadata()).width).toBe(8);
  });

  it('is best-effort: bytes it cannot parse yield null stats and no thumbnail', async () => {
    const junk = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    expect(await service.extract('image/png', junk)).toEqual({ stats: null, thumbnail: null });
  });

  it('has no extractor for a non-image mime, so it yields nothing (a later kind adds one)', async () => {
    expect(await service.extract('application/pdf', new Uint8Array([1, 2, 3]))).toEqual({
      stats: null,
      thumbnail: null,
    });
  });
});
