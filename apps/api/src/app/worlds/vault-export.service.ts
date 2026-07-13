import { posix } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ContentNode, CORE_NOTE, EntityDetail, HEXLY_METADATA_PREFIX, HEXLY_TYPE_KEY, visit } from '@hexly/domain';
import { proseMirrorToMarkdown } from '@hexly/obsidian';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { AssetsService } from '../assets/assets.service';
import { EntitiesService } from '../entities/entities.service';
import { WorldsService } from './worlds.service';

/** Not the World Owner (or it doesn't exist) — the export route maps these to 403/404. */
export type ExportResult = { filename: string; zip: Buffer } | 'not-found' | 'forbidden';

/**
 * Serialize a World back to a `.zip` of markdown + assets in its original folder shape (ADR-0033).
 * Owner-only: entities are stored under the World Owner's id, so a member's owner-scoped read
 * returns nothing anyway (ADR-0004, ADR-0024).
 */
@Injectable()
export class VaultExportService {
  constructor(
    private readonly worlds: WorldsService,
    private readonly entities: EntitiesService,
    private readonly assets: AssetsService,
  ) {}

  export(ownerId: string, worldId: string): ExportResult {
    const world = this.worlds.get(ownerId, worldId);
    if (!world) return 'not-found';
    // Owner-only (ADR-0037): a member who can read the World still can't export it. The World's
    // Rights already ship with it (ADR-0039) — read them, don't re-derive ownership here.
    if (!world.rights.includes('manage')) return 'forbidden';

    const files: Zippable = {};

    // Assets go under `assets/<originalFilename>` (human-readable, not the content hash), basename
    // only: two assets sharing a filename across folders collide, and uniquePath suffixes the later
    // ones. srcMap points each doc's capability-URL src at its own copy.
    const srcMap = new Map<string, string>();
    for (const asset of this.assets.exportAssets(worldId)) {
      const zipPath = uniquePath(files, posix.join('assets', posix.basename(asset.originalFilename)));
      files[zipPath] = asset.bytes;
      srcMap.set(asset.servedUrl, zipPath);
    }

    // Two entities that resolve to the same path (e.g. two root notes of the same name)
    // would overwrite each other in `files`; uniquePath keeps both (#150).
    const entities = this.entities.listByWorld(ownerId, worldId);
    const nameById = new Map(entities.map((e) => [e.id, e.name]));
    for (const entity of entities) {
      files[uniquePath(files, filePath(entity))] = strToU8(this.toMarkdown(entity, srcMap, nameById));
    }

    return { filename: `${world.name}.zip`, zip: Buffer.from(zipSync(files)) };
  }

  /** Serialize one Entity's Content body to Obsidian markdown (ProseMirror JSON → mdast → markdown). */
  private toMarkdown(entity: EntityDetail, srcMap: Map<string, string>, nameById: Map<string, string>): string {
    // One boundary narrow for the serializer, which needs a typed doc root.
    const doc = entity.document.content.snapshot as ContentNode;
    // In-place on the throwaway parsed snapshot: repoint asset srcs, and refresh each wikilink's
    // label to its target's CURRENT name so a post-import rename still round-trips.
    rewriteAssetSrcs(doc, srcMap);
    rewriteEntityLinks(doc, nameById);
    return proseMirrorToMarkdown(doc, frontmatter(entity));
  }
}

/** A zip key not already taken in `files`: on collision, inserts ` (2)`, ` (3)`… before the extension. */
function uniquePath(files: Zippable, path: string): string {
  if (!(path in files)) return path;
  const ext = posix.extname(path);
  const stem = ext ? path.slice(0, -ext.length) : path;
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!(candidate in files)) return candidate;
  }
}

/**
 * Point each `entityLink`'s wikilink label at its target's CURRENT name, so a renamed entity still
 * exports a `[[name]]` that resolves on re-import. A link whose target isn't in this World
 * (deleted/cross-World) keeps its stored label.
 */
function rewriteEntityLinks(snapshot: unknown, nameById: Map<string, string>): void {
  visit(snapshot, (node) => {
    if (node.type === 'entityLink' && node.attrs) {
      const current = nameById.get(String(node.attrs['entityId'] ?? ''));
      if (current) node.attrs['label'] = current;
    }
  });
}

/** Rewrite each `image` node's capability-URL src to its exported `assets/<name>` path; external srcs are absent from the map and pass through untouched. */
function rewriteAssetSrcs(snapshot: unknown, srcMap: Map<string, string>): void {
  visit(snapshot, (node) => {
    if (node.type === 'image' && node.attrs) {
      const mapped = srcMap.get(String(node.attrs['src'] ?? ''));
      if (mapped) node.attrs['src'] = mapped;
    }
  });
}

/**
 * The YAML frontmatter for an Entity: its pass-through Metadata with every reserved `hexly.*` key
 * stripped (they drive placement/typing, not frontmatter), plus its Tags re-emitted as `tags`
 * (ADR-0033) and its ordered Type set under `hexly.type` — written whole and in order, so the
 * primary type stays first (ADR-0050). A bare note (types are exactly the import default) goes
 * unstamped; undefined when nothing remains, so it exports without an empty `---` block.
 */
function frontmatter(entity: EntityDetail): Record<string, unknown> | undefined {
  const meta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entity.document.metadata ?? {})) {
    if (!key.startsWith(HEXLY_METADATA_PREFIX)) meta[key] = value;
  }
  if (entity.tags.length) meta['tags'] = [...entity.tags];
  const isBareNote = entity.types.length === 1 && entity.types[0] === CORE_NOTE;
  if (!isBareNote) meta[HEXLY_TYPE_KEY] = [...entity.types];
  return Object.keys(meta).length ? meta : undefined;
}

/**
 * The Entity's path in the exported zip: `<name>.md` placed by its original folder
 * (`hexly.sourcePath`'s directory), rebuilding the vault tree. An Entity with no
 * recorded source path (created in Hexly, not imported) lands at the zip root.
 */
function filePath(entity: EntityDetail): string {
  const source = entity.document.metadata?.['hexly.sourcePath'];
  const dir = typeof source === 'string' ? posix.dirname(source) : '.';
  const name = `${entity.name}.md`;
  return dir === '.' ? name : posix.join(dir, name);
}
