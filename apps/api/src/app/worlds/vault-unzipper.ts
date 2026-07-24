import { basename, extname } from 'node:path';
import { BadRequestException, Inject, Injectable, PayloadTooLargeException } from '@nestjs/common';
import { ApiError, ImportErrorCode } from '@hexly/domain';
import { Unzip, UnzipInflate, unzipSync } from 'fflate';
import { HEXLY_CONFIG, type HexlyConfig } from '../config';
import { ASSET_EXTENSIONS } from '../assets/assets.service';

/** Feed the archive in 64 KB slices so a single bomb file trips the ceiling mid-inflate, before it fully materializes. */
const PUSH_CHUNK = 1 << 16;

/** Internal signal: cumulative decompressed output crossed the configured ceiling. */
class VaultTooLargeError extends Error {}

/** A decompressed vault: markdown `notes` and binary `assets`, each a vault-relative-path → bytes map. */
export interface UnzippedVault {
  readonly notes: Record<string, Uint8Array>;
  readonly assets: Record<string, Uint8Array>;
}

/** Facade holding the decompressed-size ceiling from the Instance Configuration (ADR-0036); the streaming/zip-bomb logic lives in {@link unzipVault} / {@link unzipVaultFast}. */
@Injectable()
export class VaultUnzipper {
  constructor(@Inject(HEXLY_CONFIG) private readonly config: HexlyConfig) {}

  /**
   * Decompress a `.zip` into its notes and assets, guarding against a zip bomb with the
   * configured ceiling. `strictZipGuard` streams and meters actual output; disabling it
   * (the default) batch-decompresses far faster, trusting the archive's declared sizes.
   */
  unzip(archive: Buffer): UnzippedVault {
    const max = this.config.import.maxDecompressed;
    return this.config.import.strictZipGuard ? unzipVault(archive, max) : unzipVaultFast(archive, max);
  }
}

/**
 * Classify a zip entry: `.md` is a `note`, a known importable Asset extension is an `asset`
 * (ADR-0034), everything else is `skip`ped and never inflated, so an unreferenced non-Asset
 * attachment can't balloon memory.
 *
 * macOS zip tools inject an `__MACOSX/` tree of `._name` AppleDouble resource-fork files that keep
 * the original extension (`._Note.md`, `._pic.png`): binary junk, not content. Without skipping
 * them, a Mac-zipped vault imports half its files as undecodable notes.
 */
function classifyEntry(path: string): 'note' | 'asset' | 'skip' {
  if (path.endsWith('/')) return 'skip'; // directory entry
  const segments = path.split('/');
  if (segments.includes('.obsidian') || segments.includes('__MACOSX')) return 'skip';
  if (basename(path).startsWith('._')) return 'skip'; // AppleDouble sidecar
  if (path.toLowerCase().endsWith('.md')) return 'note';
  return ASSET_EXTENSIONS.has(extname(path).toLowerCase()) ? 'asset' : 'skip';
}

/**
 * Stream-decompress the archive into its vault notes and assets. Airtight against zip bombs: the
 * archive is pushed in small slices and cumulative *decompressed* output — notes AND assets — is
 * metered, so a bomb trips `maxBytes` mid-inflate, before it can materialize. A non-zip/corrupt
 * archive throws {@link BadRequestException} (400); an oversized one
 * {@link PayloadTooLargeException} (413) — never a 500.
 */
function unzipVault(archive: Buffer, maxBytes: number): UnzippedVault {
  const notes: Record<string, Uint8Array> = {};
  const assets: Record<string, Uint8Array> = {};
  let totalBytes = 0;
  // A zip made by compressing the vault *folder* nests everything under `VaultName/`, but
  // wikilinks and `hexly.sourcePath` are vault-relative (ADR-0033). Obsidian's `.obsidian/`
  // config sits at the true vault root, so its parent dir is the wrapper to strip. A
  // contents-rooted zip (`.obsidian/` at top, or absent) yields an empty prefix — no strip.
  let rootPrefix = '';

  const unzip = new Unzip((file) => {
    const marker = /^(.*\/)?\.obsidian\//.exec(file.name);
    if (marker) rootPrefix = marker[1] ?? '';
    const kind = classifyEntry(file.name);
    if (kind === 'skip') return; // never inflate config or directory entries
    const bucket = kind === 'note' ? notes : assets;
    const chunks: Uint8Array[] = [];
    file.ondata = (err, chunk, final) => {
      if (err) throw err;
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) throw new VaultTooLargeError();
      chunks.push(chunk);
      if (final) bucket[file.name] = Buffer.concat(chunks);
    };
    file.start();
  });
  unzip.register(UnzipInflate);

  const data = new Uint8Array(archive);
  // fflate's streaming reader silently yields nothing for non-zip bytes (no signature found),
  // so a non-zip would slip through as an empty import. Gate on the zip magic "PK" up front
  // (local-file-header `PK\x03\x04`, or `PK\x05\x06` for an empty archive) → a clean 400.
  if (data.length < 4 || data[0] !== 0x50 || data[1] !== 0x4b) {
    throw new BadRequestException({
      code: ImportErrorCode.NotAZip,
    } satisfies ApiError);
  }
  try {
    for (let off = 0; off < data.length; off += PUSH_CHUNK) {
      const end = Math.min(off + PUSH_CHUNK, data.length);
      unzip.push(data.subarray(off, end), end === data.length);
    }
  } catch (err) {
    if (err instanceof VaultTooLargeError) {
      throw new PayloadTooLargeException({
        code: ImportErrorCode.TooLarge,
      } satisfies ApiError);
    }
    // fflate throws on a truncated/garbage/non-zip archive.
    throw new BadRequestException({
      code: ImportErrorCode.UnreadableZip,
    } satisfies ApiError);
  }
  // Re-root once all entries are seen (zip order isn't guaranteed, so `rootPrefix` may be
  // discovered after some entries). An entry outside the detected root is left untouched.
  return {
    notes: reroot(notes, rootPrefix),
    assets: reroot(assets, rootPrefix),
  };
}

/**
 * Fast, non-airtight vault decompression (config `strictZipGuard: false`, the default): fflate's
 * batch {@link unzipSync} with a filter that (a) never decompresses skipped junk/`.obsidian`/
 * directory entries and (b) sums each entry's *declared* uncompressed size, tripping the ceiling
 * before decompressing more. Far faster than the streaming path, but the guard trusts the zip
 * header — a maliciously crafted archive can under-declare its true size. Error mapping matches
 * {@link unzipVault}: non-zip/corrupt → 400, over-ceiling → 413.
 */
function unzipVaultFast(archive: Buffer, maxBytes: number): UnzippedVault {
  const data = new Uint8Array(archive);
  if (data.length < 4 || data[0] !== 0x50 || data[1] !== 0x4b) {
    throw new BadRequestException({
      code: ImportErrorCode.NotAZip,
    } satisfies ApiError);
  }
  let rootPrefix = '';
  let declared = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, {
      filter: (file) => {
        const marker = /^(.*\/)?\.obsidian\//.exec(file.name);
        if (marker) rootPrefix = marker[1] ?? '';
        if (classifyEntry(file.name) === 'skip') return false;
        declared += file.originalSize;
        if (declared > maxBytes) throw new VaultTooLargeError();
        return true;
      },
    });
  } catch (err) {
    if (err instanceof VaultTooLargeError) {
      throw new PayloadTooLargeException({
        code: ImportErrorCode.TooLarge,
      } satisfies ApiError);
    }
    // fflate throws on a truncated/garbage/non-zip archive.
    throw new BadRequestException({
      code: ImportErrorCode.UnreadableZip,
    } satisfies ApiError);
  }
  const notes: Record<string, Uint8Array> = {};
  const assets: Record<string, Uint8Array> = {};
  for (const [name, bytes] of Object.entries(files)) {
    (classifyEntry(name) === 'note' ? notes : assets)[name] = bytes;
  }
  return {
    notes: reroot(notes, rootPrefix),
    assets: reroot(assets, rootPrefix),
  };
}

/** Strip the detected wrapper directory from every path so entries are vault-relative. */
function reroot(files: Record<string, Uint8Array>, rootPrefix: string): Record<string, Uint8Array> {
  if (!rootPrefix) return files;
  const out: Record<string, Uint8Array> = {};
  for (const [name, bytes] of Object.entries(files)) {
    out[name.startsWith(rootPrefix) ? name.slice(rootPrefix.length) : name] = bytes;
  }
  return out;
}
