import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { strToU8, zipSync } from 'fflate';
import { VaultUnzipper } from './vault-unzipper';

/** Build an in-memory `.zip` buffer from a path → text (or raw bytes) map. */
function zip(files: Record<string, string | Uint8Array>): Buffer {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, data] of Object.entries(files)) {
    entries[path] = typeof data === 'string' ? strToU8(data) : data;
  }
  return Buffer.from(zipSync(entries));
}

/** A VaultUnzipper wired to a decompressed ceiling and guard mode (airtight streaming by default). */
function unzipperWith(maxDecompressed: number, strictZipGuard = true): VaultUnzipper {
  return new VaultUnzipper({ import: { maxUpload: 0, maxDecompressed, strictZipGuard } });
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

  it('skips macOS archive junk (__MACOSX AppleDouble files) rather than treating it as notes', () => {
    // macOS zip tools inject an `__MACOSX/` tree of `._name` resource-fork files with the
    // original extension — binary AppleDouble data, not notes. They must never count as
    // notes (else half a Mac-zipped vault imports as skipped garbage).
    const { notes, assets } = unzipper.unzip(
      zip({
        'Lady Mara.md': '# Lady Mara',
        '__MACOSX/._Lady Mara.md': new Uint8Array([0, 1, 2]),
        '__MACOSX/attachments/._portrait.png': new Uint8Array([0, 1, 2]),
        'attachments/portrait.png': new Uint8Array([1, 2, 3]),
        '._Lady Mara.md': new Uint8Array([0, 1, 2]),
      }),
    );
    expect(Object.keys(notes)).toEqual(['Lady Mara.md']);
    expect(Object.keys(assets)).toEqual(['attachments/portrait.png']);
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

  describe('fast mode (strictZipGuard: false)', () => {
    const fast = unzipperWith(64 * 1024 * 1024, false);

    it('splits notes from assets and skips junk, same as the airtight path', () => {
      const { notes, assets } = fast.unzip(
        zip({
          'Lady Mara.md': '# Lady Mara',
          '.obsidian/app.json': '{}',
          '__MACOSX/._Lady Mara.md': new Uint8Array([0, 1, 2]),
          'attachments/portrait.png': new Uint8Array([1, 2, 3]),
        }),
      );
      expect(Object.keys(notes)).toEqual(['Lady Mara.md']);
      expect(Object.keys(assets)).toEqual(['attachments/portrait.png']);
    });

    it('trips 413 on the zip’s declared uncompressed size, before decompressing past the ceiling', () => {
      const bomb = zip({ 'Huge.md': 'a'.repeat(50_000) });
      expect(() => unzipperWith(1024, false).unzip(bomb)).toThrow(PayloadTooLargeException);
    });

    it('still rejects a non-zip archive with 400', () => {
      expect(() => fast.unzip(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toThrow(BadRequestException);
    });
  });
});
