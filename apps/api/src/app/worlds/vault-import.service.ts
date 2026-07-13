import { basename, posix } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  EntityType,
  HEXLY_METADATA_PREFIX,
  HEXLY_TYPE_KEY,
  ImportSummary,
  Metadata,
  nameSchema,
  tagsSchema,
  typesSchema,
} from '@hexly/domain';
import { CONTENT_FIELD, ContentNode, CORE_NOTE, tiptapContent, visit } from '@hexly/plugin-content';
import { markdownToProseMirror } from '@hexly/obsidian';
import { AssetsService } from '../assets/assets.service';
import { DB, type Db } from '../db/db';
import { EntitiesService } from '../entities/entities.service';
import { VaultUnzipper } from './vault-unzipper';
import { WorldsService } from './worlds.service';

/**
 * Vault import (ADR-0033): unzip a `.zip` server-side and turn each markdown file into an Entity in
 * a brand-new World named after the upload — a plain Note, unless its frontmatter stamps the types
 * ({@link toTypes}). Runs synchronously. Two-pass: pass 1 converts every file and assigns it an id;
 * pass 2 resolves each `[[wikilink]]` to the id of the note it names (dangling when none matches)
 * before persisting. Continue-on-error: a file that can't be read or named is skipped and tallied,
 * never aborting the import.
 */
@Injectable()
export class VaultImportService {
  constructor(
    @Inject(DB) private readonly db: Db,
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
    const worldId = this.worlds.mintWorld(ownerId, vaultName);

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
        // Every file imports as a top-level Entity — there is no Home Entity to route to (ADR-0043).
        // A legacy `hexly.isHome` flag is just reserved frontmatter, stripped below like any `hexly.*`.
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
    // (ADR-0034), then persist with the resolved content.
    const index = new NoteIndex(notes);
    const assetIndex = new AssetIndex(assetFiles);
    let linksResolved = 0;
    let linksDangling = 0;
    let assetsStored = 0;
    // One transaction for the whole persist pass: SQLite runs at synchronous=FULL (WAL), so a
    // per-note implicit transaction would fsync once each. Makes the *notes* all-or-nothing, but
    // not the import: the World was already committed by mintWorld, and storeImages' writeFileSync
    // isn't transactional — a throw here leaves an empty World and written asset files behind.
    this.db.transaction(() => {
      for (const note of notes) {
        const { resolved, dangling } = resolveLinks(note.doc, index);
        linksResolved += resolved;
        linksDangling += dangling;
        assetsStored += this.storeImages(note.doc, posix.dirname(note.path), assetIndex, assetFiles, worldId);
        const { tags, ...rest } = note.metadata;
        // Reserved `hexly.*` frontmatter is provenance a Hexly export writes (type/sourcePath),
        // consumed here and re-derived on the next export — never stored back as author Metadata (ADR-0033).
        const passThrough = Object.fromEntries(
          Object.entries(rest).filter(([key]) => !key.startsWith(HEXLY_METADATA_PREFIX)),
        );
        // The prose sits at the `content` Field key, still named directly (Vault Projection is #211);
        // the folder path is recorded under the reserved namespace so export can rebuild the tree.
        const body: Metadata = {
          ...passThrough,
          [CONTENT_FIELD.key]: tiptapContent(note.doc),
          'hexly.sourcePath': note.path,
        };
        this.entities.importEntity({
          ownerId,
          worldId,
          id: note.id,
          name: note.name,
          types: toTypes(note.metadata[HEXLY_TYPE_KEY]),
          tags: toTags(tags),
          body,
        });
      }
    });

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
   * that resolve to no vault file are left untouched. Returns how many *new* assets it stored — a
   * deduped repeat reference does not count.
   */
  private storeImages(
    doc: ContentNode,
    noteDir: string,
    index: AssetIndex,
    assetFiles: Record<string, Uint8Array>,
    worldId: string,
  ): number {
    let stored = 0;
    visit(doc, (n) => {
      if (n.type === 'image' && n.attrs) {
        const src = String(n.attrs['src'] ?? '');
        if (src && !isExternalUrl(src)) {
          const path = index.resolve(src, noteDir);
          if (path) {
            const result = this.assets.store(worldId, path, assetFiles[path]);
            n.attrs['src'] = result.url;
            if (!result.deduped) stored++;
          }
        }
      }
    });
    return stored;
  }
}

/** A converted-but-not-yet-persisted note carried between the two import passes (#147). */
interface ImportNote {
  readonly id: string;
  readonly path: string;
  readonly name: string;
  readonly doc: ContentNode;
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
function resolveLinks(node: ContentNode, index: NoteIndex): { resolved: number; dangling: number } {
  let resolved = 0;
  let dangling = 0;
  visit(node, (n) => {
    if (n.type !== 'entityLink' || !n.attrs) return;
    const label = String(n.attrs['label'] ?? '');
    // An empty label is a same-note anchor (`[[#heading]]`) — it names no note, so it is
    // neither resolved nor dangling.
    if (label === '') return;
    const id = index.resolve(label);
    if (id) {
      n.attrs['entityId'] = id;
      resolved++;
    } else {
      dangling++;
    }
  });
  return { resolved, dangling };
}

/**
 * Frontmatter `hexly.type` → the Entity's ordered Type set. Ids are validated for shape only; none
 * is resolved against a registry. Anything not a well-formed set degrades the *whole* set to a plain
 * Note rather than failing the file — never half-applied.
 */
function toTypes(raw: unknown): readonly EntityType[] {
  return typesSchema.catch([CORE_NOTE]).parse(Array.isArray(raw) ? raw : []);
}

/**
 * Frontmatter `tags` → Hexly Tags. Obsidian allows a YAML list or a single
 * comma/space-separated string; tagsSchema then trims, lower-cases, and dedupes.
 * Anything else (or absent) yields no tags.
 */
function toTags(raw: unknown): readonly string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,\s]+/) : [];
  return tagsSchema.parse(list.filter((t) => typeof t === 'string' && t.trim() !== ''));
}

/** Strict UTF-8 decode: invalid bytes throw so an unreadable file is skipped, not mojibake'd. */
function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
