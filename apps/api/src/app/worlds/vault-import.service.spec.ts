import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { strToU8, zipSync } from 'fflate';
import { VaultUnzipper } from './vault-import.service';

/** Build an in-memory `.zip` buffer from a path → text (or raw bytes) map. */
function zip(files: Record<string, string | Uint8Array>): Buffer {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, data] of Object.entries(files)) {
    entries[path] = typeof data === 'string' ? strToU8(data) : data;
  }
  return Buffer.from(zipSync(entries));
}

/** A VaultUnzipper wired to a given decompressed ceiling (the only config field it reads). */
function unzipperWith(maxDecompressed: number): VaultUnzipper {
  return new VaultUnzipper({ import: { maxUpload: 0, maxDecompressed } });
}

describe('VaultUnzipper', () => {
  const unzipper = unzipperWith(64 * 1024 * 1024);

  it('splits vault notes from asset files, skipping only .obsidian config', () => {
    const { notes, assets } = unzipper.unzip(
      zip({
        'Lady Mara.md': '# Lady Mara',
        '.obsidian/app.json': '{}',
        'attachments/portrait.png': new Uint8Array([1, 2, 3]),
      }),
    );
    // Markdown is a note; the image is an asset; `.obsidian/` config is neither (ADR-0034).
    expect(Object.keys(notes)).toEqual(['Lady Mara.md']);
    expect(Object.keys(assets)).toEqual(['attachments/portrait.png']);
    expect(new Uint8Array(assets['attachments/portrait.png'])).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('aborts with 413 when cumulative decompressed output crosses the configured ceiling (zip bomb)', () => {
    // A highly compressible note: ~50 KB inflated from a tiny compressed payload.
    const bomb = zip({ 'Huge.md': 'a'.repeat(50_000) });
    expect(() => unzipperWith(1024).unzip(bomb)).toThrow(PayloadTooLargeException);
  });

  it('meters inflated asset bytes against the ceiling too, so a bomb hidden in a .png still trips 413', () => {
    // The zip-bomb guard must cover assets now that they inflate (ADR-0034 + ADR-0036).
    const bomb = zip({ 'huge.png': 'a'.repeat(50_000) });
    expect(() => unzipperWith(1024).unzip(bomb)).toThrow(PayloadTooLargeException);
  });

  it('rejects a non-zip / corrupt archive with 400, not a 500', () => {
    expect(() => unzipper.unzip(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toThrow(
      BadRequestException,
    );
  });

  it('rejects an empty upload with 400', () => {
    expect(() => unzipper.unzip(Buffer.alloc(0))).toThrow(BadRequestException);
  });
});
