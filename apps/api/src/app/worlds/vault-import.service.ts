import { basename } from 'node:path';
import {
  BadRequestException,
  Inject,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import {
  EntityBody,
  ImportSummary,
  nameSchema,
  tagsSchema,
  tiptapContent,
} from '@hexly/domain';
import { markdownToProseMirror, type PMNode } from '@hexly/obsidian';
import { Unzip, UnzipInflate } from 'fflate';
import { HEXLY_CONFIG, type HexlyConfig } from '../config/config.module';
import { EntitiesService } from '../entities/entities.service';
import { WorldsService } from './worlds.service';

/** Feed the archive in 64 KB slices so a single bomb file trips the ceiling mid-inflate, before it fully materializes. */
const PUSH_CHUNK = 1 << 16;

/** Internal signal: cumulative decompressed output crossed the configured ceiling. */
class VaultTooLargeError extends Error {}

/**
 * Facade over the vault unzipper (ADR-0036): holds the decompressed-size ceiling from
 * the Instance Configuration so callers unzip an archive without threading the limit
 * through. The actual streaming/zip-bomb logic stays in the file-private
 * {@link unzipVaultNotes}.
 */
@Injectable()
export class VaultUnzipper {
  constructor(@Inject(HEXLY_CONFIG) private readonly config: HexlyConfig) {}

  /** Stream-decompress a `.zip` to a `path → bytes` map of vault notes; bounded by the configured ceiling. */
  unzip(archive: Buffer): Record<string, Uint8Array> {
    return unzipVaultNotes(archive, this.config.import.maxDecompressed);
  }
}

/**
 * Vault import (ADR-0033, #146): unzip a `.zip` server-side and turn each markdown
 * file into a `note` Entity in a brand-new World named after the upload. Runs
 * synchronously (a job queue is YAGNI at this scale). Continue-on-error: a file
 * that can't be read or named is skipped and tallied, never aborting the import.
 * The returned {@link ImportSummary} is the primary "what did we lose" instrument.
 */
@Injectable()
export class VaultImportService {
  constructor(
    private readonly worlds: WorldsService,
    private readonly entities: EntitiesService,
    private readonly unzipper: VaultUnzipper,
  ) {}

  import(ownerId: string, filename: string, archive: Buffer): ImportSummary {
    // Decompress first: a malformed or oversized archive fails here (400/413) BEFORE any
    // World is minted, so a bad upload never leaves an orphan empty World behind. The
    // ceiling is baked into the injected VaultUnzipper (ADR-0036).
    const files = this.unzipper.unzip(archive);

    // World name from the upload (sans .zip), run through nameSchema so a blank or
    // whitespace-only filename can't mint a whitespace-named World; falls back if it fails.
    const vaultName = nameSchema.catch('Imported Vault').parse(filename.replace(/\.zip$/i, ''));
    const { worldId } = this.worlds.mintWorldWithHome(ownerId, vaultName);

    let notesImported = 0;
    let filesSkipped = 0;
    let linksDangling = 0;
    const constructsDegraded: Record<string, number> = {};

    for (const [path, bytes] of Object.entries(files)) {
      try {
        const text = decodeUtf8(bytes);
        const name = nameSchema.parse(basename(path, '.md'));
        const { doc, metadata, degraded } = markdownToProseMirror(text);
        const { tags, ...rest } = metadata;
        const body: EntityBody = {
          type: 'note',
          content: tiptapContent(doc),
          // Frontmatter passes through as Metadata; folder path recorded under the
          // reserved `hexly.` namespace (ADR-0033) so export can rebuild the tree.
          metadata: { ...rest, 'hexly.sourcePath': path },
        };
        this.entities.importNote(ownerId, worldId, name, toTags(tags), body);
        notesImported++;
        // Every wikilink is a dangling entityLink until the resolution slice (#146).
        linksDangling += countLinks(doc);
        for (const [key, n] of Object.entries(degraded)) {
          constructsDegraded[key] = (constructsDegraded[key] ?? 0) + n;
        }
      } catch {
        // Broken/unreadable file: skip and report, never abort the whole import.
        filesSkipped++;
      }
    }

    return {
      worldId,
      notesImported,
      filesSkipped,
      linksResolved: 0,
      linksDangling,
      assetsStored: 0,
      constructsDegraded,
    };
  }
}

/** Counts the `entityLink` nodes in a converted doc — all dangling until link resolution (#146). */
function countLinks(node: PMNode): number {
  const self = node.type === 'entityLink' ? 1 : 0;
  return self + (node.content?.reduce((sum, child) => sum + countLinks(child), 0) ?? 0);
}

/**
 * Frontmatter `tags` → Hexly Tags. Obsidian allows a YAML list or a single
 * comma/space-separated string; tagsSchema then trims, lower-cases, and dedupes.
 * Anything else (or absent) yields no tags.
 */
function toTags(raw: unknown): readonly string[] {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(/[,\s]+/)
      : [];
  return tagsSchema.parse(list.filter((t) => typeof t === 'string' && t.trim() !== ''));
}

/** A vault note is a `.md` file (not a directory) outside Obsidian's `.obsidian/` config. */
function isVaultNote(path: string): boolean {
  if (path.endsWith('/')) return false; // directory entry
  if (path.split('/').includes('.obsidian')) return false;
  return path.toLowerCase().endsWith('.md');
}

/** Strict UTF-8 decode: invalid bytes throw so an unreadable file is skipped, not mojibake'd. */
function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/**
 * Stream-decompress the archive to a `path → bytes` map of vault notes only (assets and
 * `.obsidian/` config are skipped without inflating). Airtight against zip bombs: the
 * archive is pushed in small slices and cumulative *decompressed* output is metered, so a
 * bomb trips `maxBytes` mid-inflate — long before it can materialize. A non-zip/corrupt
 * archive throws {@link BadRequestException} (400); an oversized one
 * {@link PayloadTooLargeException} (413) — never a 500.
 *
 * File-private: callers go through {@link VaultUnzipper}, which supplies `maxBytes` from
 * the Instance Configuration (ADR-0036).
 */
function unzipVaultNotes(
  archive: Buffer,
  maxBytes: number,
): Record<string, Uint8Array> {
  const notes: Record<string, Uint8Array> = {};
  let totalBytes = 0;

  const unzip = new Unzip((file) => {
    if (!isVaultNote(file.name)) return; // never inflate assets or config
    const chunks: Uint8Array[] = [];
    file.ondata = (err, chunk, final) => {
      if (err) throw err;
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) throw new VaultTooLargeError();
      chunks.push(chunk);
      if (final) notes[file.name] = Buffer.concat(chunks);
    };
    file.start();
  });
  unzip.register(UnzipInflate);

  const data = new Uint8Array(archive);
  // fflate's streaming reader silently yields nothing for non-zip bytes (no signature found),
  // so a non-zip would slip through as an empty import. Gate on the zip magic "PK" up front
  // (local-file-header `PK\x03\x04`, or `PK\x05\x06` for an empty archive) → a clean 400.
  if (data.length < 4 || data[0] !== 0x50 || data[1] !== 0x4b) {
    throw new BadRequestException('Not a .zip archive');
  }
  try {
    for (let off = 0; off < data.length; off += PUSH_CHUNK) {
      const end = Math.min(off + PUSH_CHUNK, data.length);
      unzip.push(data.subarray(off, end), end === data.length);
    }
  } catch (err) {
    if (err instanceof VaultTooLargeError) {
      throw new PayloadTooLargeException('Vault exceeds the decompressed-size limit');
    }
    // fflate throws on a truncated/garbage/non-zip archive.
    throw new BadRequestException('Not a readable .zip archive');
  }
  return notes;
}
