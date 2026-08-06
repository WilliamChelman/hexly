import { basename, posix } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  emptyEntityDocument,
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
  VaultImportOptions,
  wikilinkName,
} from '@hexly/domain';
import { bodyToFields, remapVaultAssets, splitFrontmatter } from '@hexly/obsidian';
import { AssetMintService } from '../assets/asset-mint.service';
import { AssetExtraction } from '../assets/asset-extraction.service';
import { HEXLY_CONFIG, type HexlyConfig } from '../config';
import { DB, type Db } from '../db/db';
import { EntitiesService } from '../entities/entities.service';
import { TypeFieldRegistry } from '../entities/type-field-registry';
import { VaultUnzipper } from './vault-unzipper';
import { WorldsService } from './worlds.service';

/** Notes (or Assets) per transaction, and the granularity at which the import yields — the Reindex size (ADR-0046). */
export const CHUNK_SIZE = 200;

/** Hand the event loop back between chunks, so an import's synchronous writes are not all this process does. */
const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Slice into {@link CHUNK_SIZE} pages — one transaction and one yield each. */
function* chunksOf<T>(items: readonly T[]): Generator<readonly T[]> {
  for (let i = 0; i < items.length; i += CHUNK_SIZE) yield items.slice(i, i + CHUNK_SIZE);
}

/**
 * Vault import (ADR-0033, ADR-0051): unzip a `.zip` server-side and turn each markdown file into an
 * Entity in a brand-new World named after the upload — a plain Note, unless its frontmatter stamps the
 * types ({@link toTypes}). Each Field's value is read from where its **Vault Projection** put it — the
 * body below the frontmatter, or the frontmatter YAML — resolved off the type/data-type registry the API
 * composes; the converter lives behind the data-type, so this service imports no content plugin.
 *
 * Two-pass: pass 1 splits every file's frontmatter from its body and assigns it an id; pass 2 converts
 * each body Field, resolving each `[[wikilink]]` to the id of the note it names — minting an Entity for
 * one that names nothing, unless the run turns that off (ADR-0073) — before persisting in chunks that
 * each commit and yield (ADR-0046). Continue-on-error: a file that can't be read or named is skipped and
 * tallied, never aborting the import. The request awaits the whole walk — no job to poll, unlike the
 * Reindex.
 */
@Injectable()
export class VaultImportService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(HEXLY_CONFIG) private readonly config: HexlyConfig,
    private readonly worlds: WorldsService,
    private readonly entities: EntitiesService,
    private readonly unzipper: VaultUnzipper,
    private readonly assetMint: AssetMintService,
    private readonly typeFields: TypeFieldRegistry,
  ) {}

  // `options` is required rather than defaulted: `vaultImportOptionsSchema` alone says what "on by
  // default" means, so a second default here could drift from it.
  async import(
    ownerId: string,
    filename: string,
    archive: Buffer,
    options: VaultImportOptions,
  ): Promise<ImportSummary> {
    // A **caller-supplied** Type the system alone assigns is refused before anything is minted:
    // an import writes through the internal path ADR-0068 exempts from the type gate, so this run's
    // knob is the one place a request could name one. The *configured* knob is left alone — it
    // resolves verbatim, unvalidated at boot (ADR-0073).
    if (options.inlineType && this.typeFields.systemManagedTypes.includes(options.inlineType)) {
      throw new BadRequestException();
    }
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
    // Pre-extract Asset Stats + thumbnails (sharp, async) before the synchronous persist transaction
    // (ADR-0065): the mint loop runs inside that transaction and cannot await, so the mechanical
    // extraction is done up front for every binary, keyed by the vault path each file is stored under.
    const extractions = new Map<string, AssetExtraction>();
    for (const [path, bytes] of Object.entries(assetFiles))
      extractions.set(path, await this.assetMint.extract(path, bytes));
    // The "bare Note" default (ADR-0051); `undefined` when content is disabled (ADR-0052), so an
    // unstamped file lands typeless.
    const defaultType = this.typeFields.defaultType;
    // Inline Creation's own knobs, this-run-overridable and persisted nowhere. Deliberately not
    // `defaultType`, so two default Types are live in one import (ADR-0073).
    const inlineType = options.inlineType ?? this.config.entities.inlineType;
    // Folded through the Tag vocabulary like any other write, so a configured `Untriaged` still meets the
    // author's `untriaged` in the Facet rail — the one thing `inlineTag` exists to do. An override sent
    // blank is *no tag*, not an absent one: clearing the control is how a run opts out of a configured
    // Tag (ADR-0073).
    const inlineTag = options.inlineTag ?? this.config.entities.inlineTag;
    const inlineTags = tagsSchema.catch([]).parse(inlineTag ? [inlineTag] : []);
    // A minted Entity gets the Fields its Type declares, like every other mint (ADR-0050, ADR-0054):
    // without them a Hex Map inline Type would open on a blank frame rather than a plane.
    const inlineFields = resolveEffectiveFields({
      types: [inlineType],
      doc: {},
      fieldResolver: this.typeFields.fieldResolver,
      typeFieldRefs: this.typeFields.typeFieldRefs,
    });
    // A minted Entity has no vault path, so its only identity is its name — the whole dedup key.
    const mintedByName = new Map<string, string>();
    const maxCreated = this.config.import.maxCreatedEntities;
    let linksResolved = 0;
    let linksCreated = 0;
    let linksDangling = 0;
    let assetsStored = 0;
    // Chunked commits, like the Reindex walk (ADR-0046): better-sqlite3 is synchronous, so one
    // transaction over a whole vault would pin the event loop. Costs the notes their all-or-nothing — a
    // throw leaves the committed chunks behind, as in the reconcile. No per-World lock the way a reimport
    // needs one: the World is minted fresh here, so nothing else writes it across the yields.

    // Mint an Asset for EVERY binary in the zip, not only the ones a note embeds (ADR-0065): an imported
    // vault is immediately browsable, and a re-imported export re-mints its `assets/` folder by hash so
    // references heal even where prose lost the reference. Deduped per `(containerId, hash)` — twin files
    // collapse to one Entity, first (path-sorted, for determinism) name winning — and the resulting
    // `path → URL` map lets each note's storeAsset resolve its src to the already-minted capability URL.
    // Every Asset mints before the first note: a note may embed one from any chunk.
    const assetUrls = new Map<string, string>();
    for (const assetPaths of chunksOf(Object.keys(assetFiles).sort())) {
      this.db.transaction(() => {
        for (const assetPath of assetPaths) {
          const minted = this.assetMint.mint(
            ownerId,
            worldId,
            assetPath,
            assetFiles[assetPath],
            extractions.get(assetPath) ?? { stats: null, thumbnail: null },
          );
          if (!minted.deduped) assetsStored++;
          assetUrls.set(assetPath, minted.url);
        }
      });
      await yieldToEventLoop();
    }

    // `index` spans every note (pass 1), so a wikilink still resolves across a chunk boundary.
    for (const chunk of chunksOf(notes)) {
      this.db.transaction(() => {
        for (const note of chunk) {
          const noteDir = posix.dirname(note.path);
          const context: VaultImportContext = {
            // The one seam every wikilink passes through, so auto-creation slots in on the miss and
            // vault-wide dedup costs no extra pass (ADR-0073).
            resolveLink: (label) => {
              const id = index.resolve(label, noteDir);
              if (id) {
                linksResolved++;
                return id;
              }
              if (!options.createUnresolved) {
                linksDangling++;
                return null;
              }
              // The basename, never the explicit path: `[[folder/Zorblax]]` names *Zorblax* (ADR-0073) —
              // shared with the editor's promotion, so one link never names two Entities. A label that
              // is no name at all stays an Unresolved Link rather than minting a blank.
              const name = nameSchema.safeParse(wikilinkName(label));
              if (!name.success) {
                linksDangling++;
                return null;
              }
              // Case-insensitively, as ADR-0033 matches every other link label.
              const key = name.data.toLowerCase();
              const already = mintedByName.get(key);
              if (already) {
                linksResolved++;
                return already;
              }
              // Past the run's ceiling the link stays unresolved rather than minting — one note's links
              // all mint inside that note's single synchronous transaction — and tallies as dangling, so
              // the import still lands and the summary says what happened (ADR-0073).
              if (mintedByName.size >= maxCreated) {
                linksDangling++;
                return null;
              }
              const mintedId = randomUUID();
              this.entities.importEntity({
                ownerId,
                containerId: worldId,
                id: mintedId,
                name: name.data,
                types: [inlineType],
                tags: inlineTags,
                document: emptyEntityDocument(inlineFields, dataTypes),
              });
              mintedByName.set(key, mintedId);
              linksCreated++;
              return mintedId;
            },
            storeAsset: (src) => {
              if (!src || isExternalUrl(src)) return null;
              const assetPath = assetIndex.resolve(src, noteDir);
              // The Asset was already minted above; rewrite the note's src to its capability URL (ADR-0065).
              return assetPath ? (assetUrls.get(assetPath) ?? null) : null;
            },
            degrade,
          };

          const types = toTypes(note.frontmatter[HEXLY_TYPE_KEY], defaultType);
          // Resolve body Fields from the stamped types over the effective-set path (id → Field, ADR-0054),
          // with the default type appended as the lowest-priority fallback: a foreign or unregistered-type
          // note still lands its prose in `content` rather than losing it, while a type that references
          // `content` itself keeps its own projection (deduped by key, primary type first). No default type
          // → no fallback. The body Fields come from the stamped types alone — the document is being built
          // here, so there is nothing yet to derive attachments from (`doc: {}`, ADR-0057). A namespaced
          // frontmatter key becomes an attachment naturally once the imported document is read back.
          const fields = resolveEffectiveFields({
            types: defaultType ? [...types, defaultType] : [...types],
            doc: {},
            fieldResolver: this.typeFields.fieldResolver,
            typeFieldRefs: this.typeFields.typeFieldRefs,
          });
          const bodyValues = bodyToFields({ body: note.body, fields, dataTypes, context });

          const { tags, ...rest } = note.frontmatter;
          // Reserved `hexly.*` frontmatter is provenance a Hexly export writes (type/sourcePath), consumed
          // here and re-derived on the next export — never stored back as author EntityDocument (ADR-0033).
          // A frontmatter key a body Field also fills is dropped: the body is authoritative for it.
          // Its Assets resolve through the same `storeAsset` seam a body Field's do, so a Board's Image
          // heals to a capability URL in THIS World rather than staying a vault path — or, worse, riding
          // back in as the foreign URL it was exported from, which would repoint at that Container
          // instead of copying it (ADR-0080).
          const passThrough = Object.fromEntries(
            Object.entries(rest)
              .filter(([key]) => !key.startsWith(HEXLY_METADATA_PREFIX) && !(key in bodyValues))
              .map(([key, value]) => [key, remapVaultAssets(value, context.storeAsset)]),
          );
          const doc: EntityDocument = {
            ...passThrough,
            ...bodyValues,
            'hexly.sourcePath': note.path,
          };
          this.entities.importEntity({
            ownerId,
            containerId: worldId,
            id: note.id,
            name: note.name,
            types,
            tags: toTags(tags),
            document: doc,
          });
        }
      });
      await yieldToEventLoop();
    }

    return {
      worldId,
      notesImported: notes.length,
      filesSkipped,
      linksResolved,
      linksCreated,
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

  /**
   * Returns the target note's id, or null when the label names no imported note (a dangling link).
   *
   * Resolved over the candidate ladder {@link AssetIndex} walks, and for the same reason: a form the
   * index could have answered must not fall through, now that a miss mints a duplicate rather than an
   * inert dangling link (ADR-0073). Note-relative first (Obsidian's stock "relative path to file"
   * setting writes `[[../places/Rivendell]]`), then vault-root, then basename — the last of which still
   * finds the note in a vault zipped inside a wrapper directory no `.obsidian/` marked for stripping.
   * Both path candidates precede the basename one, so a path-qualified link keeps disambiguating two
   * notes that share a filename (ADR-0033).
   */
  resolve(label: string, noteDir: string): string | null {
    return (
      this.byPath.get(normalizeKey(posix.join(noteDir, label))) ??
      this.byPath.get(normalizeKey(label)) ??
      this.byBasename.get(posix.basename(normalizeKey(label))) ??
      null
    );
  }
}

/**
 * Lower-case, resolve `./`/`../`, drop a leading `/` or `./` and a trailing `.md`, so link labels and
 * vault paths compare uniformly whichever of Obsidian's link-format settings wrote them.
 */
function normalizeKey(value: string): string {
  return posix.normalize(value.replace(/^\/+/, '')).replace(/^\.\//, '').toLowerCase().replace(/\.md$/, '');
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
