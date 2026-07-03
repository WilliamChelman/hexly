import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { strToU8, zipSync } from 'fflate';
import { unzipVaultNotes } from './vault-import.service';

/** Build an in-memory `.zip` buffer from a path → text map. */
function zip(files: Record<string, string>): Buffer {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, text] of Object.entries(files)) entries[path] = strToU8(text);
  return Buffer.from(zipSync(entries));
}

describe('unzipVaultNotes', () => {
  it('returns only vault notes, skipping assets and .obsidian config without inflating them', () => {
    const notes = unzipVaultNotes(
      zip({
        'Lady Mara.md': '# Lady Mara',
        '.obsidian/app.json': '{}',
        'attachments/notes.txt': 'not markdown',
      }),
    );
    expect(Object.keys(notes)).toEqual(['Lady Mara.md']);
  });

  it('aborts with 413 when cumulative decompressed output crosses the ceiling (zip bomb)', () => {
    // A highly compressible note: ~50 KB inflated from a tiny compressed payload.
    const bomb = zip({ 'Huge.md': 'a'.repeat(50_000) });
    expect(() => unzipVaultNotes(bomb, 1024)).toThrow(PayloadTooLargeException);
  });

  it('rejects a non-zip / corrupt archive with 400, not a 500', () => {
    expect(() => unzipVaultNotes(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toThrow(
      BadRequestException,
    );
  });

  it('rejects an empty upload with 400', () => {
    expect(() => unzipVaultNotes(Buffer.alloc(0))).toThrow(BadRequestException);
  });
});
