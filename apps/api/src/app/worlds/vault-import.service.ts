import { basename, posix } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  EntityType,
  HEXLY_METADATA_PREFIX,
  HEXLY_TYPE_KEY,
  ImportSummary,
  EntityDocument,
  nameSchema,
  resolveEffectiveFields,
  tagsSchema,
  typesSchema,
  VaultImportContext,
} from '@hexly/domain';
import { bodyToFields, splitFrontmatter } from '@hexly/obsidian';
import { AssetsService } from '../assets/assets.service';
import { DB, type Db } from '../db/db';
import { EntitiesService } from '../entities/entities.service';
import { TypeFieldRegistry } from '../entities/type-field-registry';
import { VaultUnzipper } from './vault-unzipper';
import { WorldsService } from './worlds.service';

/**
 * Vault import (ADR-0033, ADR-0051): unzip a `.zip` server-side and turn each markdown file into an
 * Entity in a brand-new World named after the upload — a plain Note, unless its frontmatter stamps the
 * types ({@link toTypes}). Each Field's value is read from where its **Vault Projection** put it — the
 * body below the frontmatter, or the frontmatter YAML — resolved off the type/data-type registry the API
 * composes; the converter lives behind the data-type, so this service imports no content plugin.
 *
 * Runs synchronously. Two-pass: pass 1 splits every file's frontmatter from its body and assigns it an
 * id; pass 2 converts each body Field, resolving each `[[wikilink]]` to the id of the note it names
 * (dangling when none matches) before persisting. Continue-on-error: a file that can't be read or named
 * is skipped and tallied, never aborting the import.
 */
@Injectable()
export class VaultImportService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly worlds: WorldsService,
    private readonly entities: EntitiesService,
    private readonly unzipper: VaultUnzipper,
    private readonly assets: AssetsService,
    private readonly typeFields: TypeFieldRegistry,
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
    const degrade = (construct: string, count = 1) => {
      constructsDegraded[construct] = (constructsDegraded[construct] ?? 0) + count;
    };

    // Pass 1: split every file's frontmatter from its body and assign it an id, so wikilinks can be
    // resolved against the full set before anything is persisted (#147). A file that can't be read or
    // named is skipped here and never enters the index. Body conversion waits for pass 2, when the link
    // index exists.
    const notes: ImportNote[] = [];
    for (const [path, bytes] of Object.entries(files)) {
      try {
        const text = decodeUtf8(bytes);
        const name = nameSchema.parse(basename(path, '.md'));
        const { frontmatter, body, degraded } = splitFrontmatter(text);
        // Every file imports as a top-level Entity — there is no Home Entity to route to (ADR-0043).
        // A legacy `hexly.isHome` flag is just reserved frontmatter, stripped below like any `hexly.*`.
        notes.push({ id: randomUUID(), path, name, frontmatter, body });
        for (const [key, n] of Object.entries(degraded)) degrade(key, n);
      } catch {
        // Broken/unreadable file: skip and report, never abort the whole import.
        filesSkipped++;
      }
    }

    // Pass 2: convert each note's body Fields with a context bound to the indices — resolving each
    // `[[wikilink]]` to a note id (ADR-0046), storing each embedded image content-addressed and
    // rewriting its src to the capability URL (ADR-0034) — then persist. The registry is instance-wide:
    // a brand-new World has no user-defined types yet, so the bundled resolver covers every file.
    const index = new NoteIndex(notes);
    const assetIndex = new AssetIndex(assetFiles);
    const dataTypes = this.typeFields.structuredDataTypes;
    // The "bare Note" default (ADR-0051); `undefined` when content is disabled (ADR-0052), so an
    // unstamped file lands typeless.
    const defaultType = this.typeFields.defaultType;
    let linksResolved = 0;
    let linksDangling = 0;
    let assetsStored = 0;
    // One transaction for the whole persist pass: SQLite runs at synchronous=FULL (WAL), so a
    // per-note implicit transaction would fsync once each. Makes the *notes* all-or-nothing, but
    // not the import: the World was already committed by mintWorld, and the asset store's writeFileSync
    // isn't transactional — a throw here leaves an empty World and written asset files behind.
    this.db.transaction(() => {
      for (const note of notes) {
        const noteDir = posix.dirname(note.path);
        const context: VaultImportContext = {
          resolveLink: (label) => {
            const id = index.resolve(label);
            if (id) linksResolved++;
            else linksDangling++;
            return id;
          },
          storeAsset: (src) => {
            if (!src || isExternalUrl(src)) return null;
            const assetPath = assetIndex.resolve(src, noteDir);
            if (!assetPath) return null;
            const result = this.assets.store(worldId, assetPath, assetFiles[assetPath]);
            if (!result.deduped) assetsStored++;
            return result.url;
          },
          degrade,
        };

        const types = toTypes(note.frontmatter[HEXLY_TYPE_KEY], defaultType);
        // Resolve body Fields from the stamped types over the effective-set path (id → Field, ADR-0054),
        // with the default type appended as the lowest-priority fallback: a foreign or unregistered-type
        // note still lands its prose in `content` rather than losing it, while a type that references
        // `content` itself keeps its own projection (deduped by key, primary type first). No default type
        // → no fallback. A brand-new World has no user-defined types/Fields, so the Plugin resolvers cover
        // every file — no attachments (`fieldIds: []`) on a fresh import.
        const fields = resolveEffectiveFields({
          types: defaultType ? [...types, defaultType] : [...types],
          fieldIds: [],
          fieldResolver: this.typeFields.fieldResolver,
          typeFieldRefs: this.typeFields.typeFieldRefs,
        });
        const bodyValues = bodyToFields({ body: note.body, fields, dataTypes, context });

        const { tags, ...rest } = note.frontmatter;
        // Reserved `hexly.*` frontmatter is provenance a Hexly export writes (type/sourcePath), consumed
        // here and re-derived on the next export — never stored back as author EntityDocument (ADR-0033).
        // A frontmatter key a body Field also fills is dropped: the body is authoritative for it.
        const passThrough = Object.fromEntries(
          Object.entries(rest).filter(([key]) => !key.startsWith(HEXLY_METADATA_PREFIX) && !(key in bodyValues)),
        );
        const doc: EntityDocument = {
          ...passThrough,
          ...bodyValues,
          'hexly.sourcePath': note.path,
        };
        this.entities.importEntity({
          ownerId,
          worldId,
          id: note.id,
          name: note.name,
          types,
          tags: toTags(tags),
          document: doc,
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
}

/** A split-but-not-yet-persisted note carried between the two import passes (#147). */
interface ImportNote {
  readonly id: string;
  readonly path: string;
  readonly name: string;
  readonly frontmatter: Record<string, unknown>;
  readonly body: string;
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
 * Frontmatter `hexly.type` → the Entity's ordered Type set. Ids are validated for shape only; none
 * is resolved against a registry. Anything not a well-formed set degrades the *whole* set to the
 * default rather than failing the file — never half-applied. No default type (content disabled,
 * ADR-0052) falls back to an empty set, so an unstamped file imports typeless.
 */
function toTypes(raw: unknown, defaultType: EntityType | undefined): readonly EntityType[] {
  return typesSchema.catch(defaultType ? [defaultType] : []).parse(Array.isArray(raw) ? raw : []);
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
