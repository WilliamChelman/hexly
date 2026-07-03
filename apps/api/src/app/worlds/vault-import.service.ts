import { basename, extname, posix } from 'node:path';
import { randomUUID } from 'node:crypto';
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
import { ASSET_EXTENSIONS, AssetsService } from '../assets/assets.service';
import { EntitiesService } from '../entities/entities.service';
import { WorldsService } from './worlds.service';

/** Feed the archive in 64 KB slices so a single bomb file trips the ceiling mid-inflate, before it fully materializes. */
const PUSH_CHUNK = 1 << 16;

/** Internal signal: cumulative decompressed output crossed the configured ceiling. */
class VaultTooLargeError extends Error {}

/** A decompressed vault: markdown `notes` and binary `assets`, each a vault-relative-path → bytes map. */
export interface UnzippedVault {
  readonly notes: Record<string, Uint8Array>;
  readonly assets: Record<string, Uint8Array>;
}

/**
 * Facade over the vault unzipper (ADR-0036): holds the decompressed-size ceiling from
 * the Instance Configuration so callers unzip an archive without threading the limit
 * through. The actual streaming/zip-bomb logic stays in the file-private
 * {@link unzipVault}.
 */
@Injectable()
export class VaultUnzipper {
  constructor(@Inject(HEXLY_CONFIG) private readonly config: HexlyConfig) {}

  /** Stream-decompress a `.zip` into its notes and assets; both metered against the configured ceiling. */
  unzip(archive: Buffer): UnzippedVault {
    return unzipVault(archive, this.config.import.maxDecompressed);
  }
}

/**
 * Vault import (ADR-0033): unzip a `.zip` server-side and turn each markdown file
 * into a `note` Entity in a brand-new World named after the upload. Runs synchronously
 * (a job queue is YAGNI at this scale). Two-pass (#147): pass 1 converts every file and
 * assigns it an id; pass 2 resolves each `[[wikilink]]` to the id of the note it names
 * (dangling when none matches) before persisting. Continue-on-error: a file that can't be
 * read or named is skipped and tallied, never aborting the import. The returned
 * {@link ImportSummary} is the primary "what did we lose" instrument.
 */
@Injectable()
export class VaultImportService {
  constructor(
    private readonly worlds: WorldsService,
    private readonly entities: EntitiesService,
    private readonly unzipper: VaultUnzipper,
    private readonly assets: AssetsService,
  ) {}

  import(ownerId: string, filename: string, archive: Buffer): ImportSummary {
    // Decompress first: a malformed or oversized archive fails here (400/413) BEFORE any
    // World is minted, so a bad upload never leaves an orphan empty World behind. The
    // ceiling is baked into the injected VaultUnzipper (ADR-0036).
    const { notes: files, assets: assetFiles } = this.unzipper.unzip(archive);

    // World name from the upload (sans .zip), run through nameSchema so a blank or
    // whitespace-only filename can't mint a whitespace-named World; falls back if it fails.
    const vaultName = nameSchema.catch('Imported Vault').parse(filename.replace(/\.zip$/i, ''));
    const { worldId } = this.worlds.mintWorldWithHome(ownerId, vaultName);

    let filesSkipped = 0;
    const constructsDegraded: Record<string, number> = {};

    // Pass 1: convert every file and assign it an id, so wikilinks can be resolved against
    // the full set before anything is persisted (#147). A file that can't be read or named
    // is skipped here and never enters the index.
    const notes: ImportNote[] = [];
    for (const [path, bytes] of Object.entries(files)) {
      try {
        const text = decodeUtf8(bytes);
        const name = nameSchema.parse(basename(path, '.md'));
        const { doc, metadata, degraded } = markdownToProseMirror(text);
        notes.push({ id: randomUUID(), path, name, doc, metadata });
        for (const [key, n] of Object.entries(degraded)) {
          constructsDegraded[key] = (constructsDegraded[key] ?? 0) + n;
        }
      } catch {
        // Broken/unreadable file: skip and report, never abort the whole import.
        filesSkipped++;
      }
    }

    // Pass 2: resolve each note's wikilinks against the index (mutating the docs in place),
    // store any embedded images content-addressed and rewrite their src to the capability URL
    // (ADR-0034), then persist with the resolved content and a single insert per note.
    const index = new NoteIndex(notes);
    const assetIndex = new AssetIndex(assetFiles);
    let linksResolved = 0;
    let linksDangling = 0;
    let assetsStored = 0;
    for (const note of notes) {
      const { resolved, dangling } = resolveLinks(note.doc, index);
      linksResolved += resolved;
      linksDangling += dangling;
      assetsStored += this.storeImages(note.doc, posix.dirname(note.path), assetIndex, assetFiles, worldId);
      const { tags, ...rest } = note.metadata;
      const body: EntityBody = {
        type: 'note',
        content: tiptapContent(note.doc),
        // Frontmatter passes through as Metadata; folder path recorded under the
        // reserved `hexly.` namespace (ADR-0033) so export can rebuild the tree.
        metadata: { ...rest, 'hexly.sourcePath': note.path },
      };
      this.entities.importNote(ownerId, worldId, note.id, note.name, toTags(tags), body);
    }

    return {
      worldId,
      notesImported: notes.length,
      filesSkipped,
      linksResolved,
      linksDangling,
      assetsStored,
      constructsDegraded,
    };
  }

  /**
   * Walk a converted doc's `image` nodes (mutating in place): a vault-relative src is resolved
   * against the vault's asset files, stored content-addressed (ADR-0034), and its src rewritten
   * to the served `/assets/...` capability URL. External URLs (`https://…`, `data:`) and images
   * that resolve to no vault file are left untouched. Returns how many *new* assets it stored
   * (dedup makes a repeat reference cost nothing), so the summary counts unique stored assets.
   */
  private storeImages(
    doc: PMNode,
    noteDir: string,
    index: AssetIndex,
    assetFiles: Record<string, Uint8Array>,
    worldId: string,
  ): number {
    let stored = 0;
    const walk = (n: PMNode) => {
      if (n.type === 'image' && n.attrs) {
        const src = String(n.attrs.src ?? '');
        if (src && !isExternalUrl(src)) {
          const path = index.resolve(src, noteDir);
          if (path) {
            const result = this.assets.store(worldId, path, assetFiles[path]);
            n.attrs.src = result.url;
            if (!result.deduped) stored++;
          }
        }
      }
      n.content?.forEach(walk);
    };
    walk(doc);
    return stored;
  }
}

/** A converted-but-not-yet-persisted note carried between the two import passes (#147). */
interface ImportNote {
  readonly id: string;
  readonly path: string;
  readonly name: string;
  readonly doc: PMNode;
  readonly metadata: Record<string, unknown>;
}

/**
 * The wikilink resolution index (#147): maps a link target to the id of the note it names.
 * A path-qualified `[[folder/Note]]` resolves by exact vault path; a bare `[[Note]]` resolves
 * by basename, and an ambiguous basename (two notes share a filename) resolves to the first
 * in path-sorted order — a deterministic default (ADR-0033). All matching is case-insensitive
 * with a trailing `.md` ignored, mirroring how Obsidian writes links.
 */
class NoteIndex {
  private readonly byBasename = new Map<string, string>();
  private readonly byPath = new Map<string, string>();

  constructor(notes: readonly ImportNote[]) {
    // Sort by path so an ambiguous basename resolves to a stable first match.
    for (const note of [...notes].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
      const base = basename(note.path, '.md').toLowerCase();
      if (!this.byBasename.has(base)) this.byBasename.set(base, note.id);
      this.byPath.set(normalizeKey(note.path), note.id);
    }
  }

  /** Returns the target note's id, or null when the label names no imported note (a dangling link). */
  resolve(label: string): string | null {
    const key = normalizeKey(label);
    const found = key.includes('/') ? this.byPath.get(key) : this.byBasename.get(key);
    return found ?? null;
  }
}

/** Lower-case and drop a trailing `.md` so link labels and vault paths compare uniformly. */
function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/\.md$/, '');
}

/**
 * Resolves an `image` node's src to the vault asset file it names (ADR-0034). Handles both link
 * shapes a converted doc carries: a standard-markdown path (`attachments/x.png`, resolved
 * relative to the note's folder, then vault-root) and an Obsidian embed's bare filename
 * (`![[x.png]]` → `x.png`, resolved vault-wide by basename, first in path-sorted order for a
 * duplicate name). Matching is case-insensitive with URL-escapes decoded.
 */
class AssetIndex {
  private readonly byPath = new Map<string, string>();
  private readonly byBasename = new Map<string, string>();

  constructor(assetFiles: Record<string, Uint8Array>) {
    for (const path of Object.keys(assetFiles).sort()) {
      this.byPath.set(normalizeAssetKey(path), path);
      const base = posix.basename(path).toLowerCase();
      if (!this.byBasename.has(base)) this.byBasename.set(base, path);
    }
  }

  /** The original asset-file key (map into `assetFiles`), or null when the src names no vault asset. */
  resolve(src: string, noteDir: string): string | null {
    const decoded = decodeUri(src);
    const candidates = [
      normalizeAssetKey(posix.join(noteDir, decoded)), // note-relative (standard markdown)
      normalizeAssetKey(decoded), // vault-root-relative
    ];
    for (const key of candidates) {
      const hit = this.byPath.get(key);
      if (hit) return hit;
    }
    // Obsidian embeds resolve by filename across the whole vault.
    return this.byBasename.get(posix.basename(decoded).toLowerCase()) ?? null;
  }
}

/** Normalize a vault path for asset matching: resolve `./`/`../`, drop a leading `./`, lower-case. */
function normalizeAssetKey(value: string): string {
  return posix.normalize(value).replace(/^\.\//, '').toLowerCase();
}

/** Decode `%20`-style escapes an editor writes into image src; a malformed escape falls back to raw. */
function decodeUri(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** An external image src (has a URL scheme like `https:`/`data:`, or is protocol-relative) — not a vault path. */
function isExternalUrl(src: string): boolean {
  return /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(src);
}

/**
 * Walks a converted doc, resolving each `entityLink`'s `label` to an `entityId` via the index
 * (mutating in place) and tallying resolved vs. dangling. An unresolved link keeps `entityId: null`
 * so its intent survives as a dangling link (#147). Only `entityLink` nodes count — a `![[X]]`
 * embed is already a plain link, so it never reaches here.
 */
function resolveLinks(node: PMNode, index: NoteIndex): { resolved: number; dangling: number } {
  let resolved = 0;
  let dangling = 0;
  const walk = (n: PMNode) => {
    if (n.type === 'entityLink' && n.attrs) {
      const label = String(n.attrs.label ?? '');
      // An empty label is a same-note anchor (`[[#heading]]`) — it names no note, so it is
      // neither resolved nor dangling.
      if (label !== '') {
        const id = index.resolve(label);
        if (id) {
          n.attrs.entityId = id;
          resolved++;
        } else {
          dangling++;
        }
      }
    }
    n.content?.forEach(walk);
  };
  walk(node);
  return { resolved, dangling };
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

/**
 * Classify a zip entry: a `.md` file is a `note`, a file with a known importable Asset
 * extension is an `asset` (ADR-0034), and everything else — directory entries, Obsidian's
 * `.obsidian/` config, and unsupported files (videos, nested zips, stray `.txt`) — is
 * `skip`ped and never inflated, so an unreferenced non-Asset attachment can't balloon memory.
 */
function classifyEntry(path: string): 'note' | 'asset' | 'skip' {
  if (path.endsWith('/')) return 'skip'; // directory entry
  if (path.split('/').includes('.obsidian')) return 'skip';
  if (path.toLowerCase().endsWith('.md')) return 'note';
  return ASSET_EXTENSIONS.has(extname(path).toLowerCase()) ? 'asset' : 'skip';
}

/** Strict UTF-8 decode: invalid bytes throw so an unreadable file is skipped, not mojibake'd. */
function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/**
 * Stream-decompress the archive into its vault notes and assets (`.obsidian/` config and
 * directory entries are skipped without inflating). Airtight against zip bombs: the archive is
 * pushed in small slices and cumulative *decompressed* output — notes AND assets — is metered,
 * so a bomb trips `maxBytes` mid-inflate, long before it can materialize (ADR-0034 stores assets
 * uncapped, but this ceiling still backstops a malicious archive). A non-zip/corrupt archive
 * throws {@link BadRequestException} (400); an oversized one {@link PayloadTooLargeException}
 * (413) — never a 500.
 *
 * File-private: callers go through {@link VaultUnzipper}, which supplies `maxBytes` from
 * the Instance Configuration (ADR-0036).
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
  // Re-root once all entries are seen (zip order isn't guaranteed, so `rootPrefix` may be
  // discovered after some entries). An entry outside the detected root is left untouched.
  return { notes: reroot(notes, rootPrefix), assets: reroot(assets, rootPrefix) };
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
