import { posix } from 'node:path';
import { Injectable } from '@nestjs/common';
import { EntityDetail, EntityType, HEXLY_TYPE_KEY, VaultExportContext } from '@hexly/domain';
import { CORE_ASSET_TYPE_ID } from '@hexly/plugin-asset';
import { entityToMarkdown } from '@hexly/obsidian';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { AssetsService } from '../assets/assets.service';
import { EntitiesService } from '../entities/entities.service';
import { TypeFieldRegistry } from '../entities/type-field-registry';
import { WorldTypeFields } from '../entities/world-type-fields';
import { WorldsService } from './worlds.service';

/** Not the World Owner (or it doesn't exist) — the export route maps these to 403/404. */
export type ExportResult = { filename: string; zip: Buffer } | 'not-found' | 'forbidden';

/**
 * Serialize a World back to a `.zip` of markdown + assets in its original folder shape (ADR-0033,
 * ADR-0051). Each Field's **Vault Projection** decides where its value lands — prose to the body, a grid
 * to frontmatter — resolved off the type/data-type registry the API composes; the serializer itself
 * (`@hexly/obsidian`) imports no content plugin. Owner-only: entities are stored under the World Owner's
 * id, so a member's owner-scoped read returns nothing anyway (ADR-0004, ADR-0024).
 */
@Injectable()
export class VaultExportService {
  constructor(
    private readonly worlds: WorldsService,
    private readonly entities: EntitiesService,
    private readonly assets: AssetsService,
    private readonly typeFields: TypeFieldRegistry,
    private readonly worldTypeFields: WorldTypeFields,
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
      // An Asset Entity is lossy binary passthrough (ADR-0065): its bytes were already written above,
      // under `name + ext`; it has no Markdown projection, so it never lands as a `.md` file.
      if (entity.types.includes(CORE_ASSET_TYPE_ID)) continue;
      files[uniquePath(files, filePath(entity))] = strToU8(this.toMarkdown(entity, srcMap, nameById, worldId));
    }

    return { filename: `${world.name}.zip`, zip: Buffer.from(zipSync(files)) };
  }

  /** Serialize one Entity to Obsidian markdown, each Field going where its Vault Projection says (ADR-0051). */
  private toMarkdown(
    entity: EntityDetail,
    srcMap: Map<string, string>,
    nameById: Map<string, string>,
    worldId: string,
  ): string {
    const context: VaultExportContext = {
      // A wikilink's label refreshes to its target's CURRENT name so a post-import rename round-trips;
      // a target outside this World keeps its stored label (undefined → the converter leaves it).
      entityName: (id) => nameById.get(id),
      // An image's capability-URL src repoints at its exported `assets/<name>` copy; an external src is
      // absent from the map and passes through untouched.
      assetPath: (url) => srcMap.get(url),
    };
    return entityToMarkdown({
      doc: entity.document,
      // The Entity's effective Field set — its types' defaults plus the attachments derived from its
      // document (ADR-0054/ADR-0057) — so a directly-attached Field's Vault Projection lands correctly
      // too, not just a type default's.
      fields: this.worldTypeFields.effectiveFields(worldId, entity.types, entity.document),
      dataTypes: this.typeFields.structuredDataTypes,
      frontmatter: frontmatterAdditions(entity, this.typeFields.defaultType),
      context,
    });
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
 * The Entity-level frontmatter the vault layer merges after stripping `hexly.*`: the Tags re-emitted as
 * `tags` (ADR-0033), and the ordered Type set under `hexly.type` — written whole and in order so the
 * primary type stays first (ADR-0050). A bare Note (types are exactly the import default) goes
 * unstamped, so an ordinary note with no other EntityDocument keys exports with no `---` block at all.
 * With no default type (content disabled, ADR-0052) nothing is "bare", so every Entity's types are stamped.
 */
function frontmatterAdditions(entity: EntityDetail, defaultType: EntityType | undefined): Record<string, unknown> {
  const additions: Record<string, unknown> = {};
  if (entity.tags.length) additions['tags'] = [...entity.tags];
  const isBareNote = defaultType !== undefined && entity.types.length === 1 && entity.types[0] === defaultType;
  if (!isBareNote) additions[HEXLY_TYPE_KEY] = [...entity.types];
  return additions;
}

/**
 * The Entity's path in the exported zip: `<name>.md` placed by its original folder
 * (`hexly.sourcePath`'s directory), rebuilding the vault tree. An Entity with no
 * recorded source path (created in Hexly, not imported) lands at the zip root.
 */
function filePath(entity: EntityDetail): string {
  const source = entity.document['hexly.sourcePath'];
  const dir = typeof source === 'string' ? posix.dirname(source) : '.';
  const name = `${entity.name}.md`;
  return dir === '.' ? name : posix.join(dir, name);
}
