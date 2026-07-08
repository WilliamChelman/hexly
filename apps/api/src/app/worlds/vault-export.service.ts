import { posix } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ContentNode, EntityDetail, HEXLY_METADATA_PREFIX, visit } from '@hexly/domain';
import { proseMirrorToMarkdown } from '@hexly/obsidian';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { AssetsService } from '../assets/assets.service';
import { EntitiesService } from '../entities/entities.service';
import { WorldsService } from './worlds.service';

/** Not the World Owner (or it doesn't exist) — the export route maps these to 403/404. */
export type ExportResult = { filename: string; zip: Buffer } | 'not-found' | 'forbidden';

/**
 * Vault export (ADR-0033, #150): serialize a World back to a `.zip` of markdown + assets in the
 * original folder shape — the round-trip fidelity check for a vault the owner imported. Pure
 * serialization; stores nothing new. Owner-only: entities are stored under the World Owner's id,
 * so a member's owner-scoped read returns nothing anyway (ADR-0004, ADR-0024).
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

    // Assets go under `assets/<originalFilename>` (human-readable, not the content hash); the map
    // rewrites each doc's capability-URL src back to that path. Basename only, so two assets
    // sharing a filename across folders would collide under assets/ — uniquePath suffixes the
    // later ones (` (2)`) so no bytes are lost, and srcMap points each doc at its own copy.
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

/**
 * A zip key not already taken in `files`: on collision, inserts ` (2)`, ` (3)`… before the
 * extension so two entities/assets that resolve to the same path both survive the export (#150).
 */
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
 * Point each `entityLink`'s wikilink label at its target's CURRENT name, so an entity renamed after
 * import still exports a `[[name]]` that resolves to the right file on re-import (#150). A link whose
 * target isn't in this World (deleted/cross-World) keeps its stored label.
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
 * The YAML frontmatter for an Entity: its pass-through Metadata with every reserved `hexly.*`
 * key stripped (they drive placement/typing, not frontmatter), plus its Tags re-emitted as
 * `tags` so a vault's `tags:` round-trips (ADR-0033). Returns undefined when nothing remains,
 * so a bare note exports without an empty `---` block.
 */
function frontmatter(entity: EntityDetail): Record<string, unknown> | undefined {
  const meta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entity.document.metadata ?? {})) {
    if (!key.startsWith(HEXLY_METADATA_PREFIX)) meta[key] = value;
  }
  if (entity.tags.length) meta['tags'] = [...entity.tags];
  // A hexmap exports lore only (grid dropped); flag the type so the loss is visible (ADR-0033).
  if (entity.type === 'hexmap') meta['hexly.type'] = 'hexmap';
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
