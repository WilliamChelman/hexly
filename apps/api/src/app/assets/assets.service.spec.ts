import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASSET_EMBED_EXTENSIONS } from '@hexly/plugin-content';
import { createDb, Db } from '../db/db';
import { EntityDeletionRegistry } from '../entities/entity-deletion-registry';
import { ASSET_EXTENSIONS, AssetsService } from './assets.service';

describe('asset extension parity', () => {
  // The obsidian converter decides what `![[…]]` becomes an image node; this service decides
  // what MIME it serves. If the two lists drift, an embeddable type serves as octet-stream (or a
  // storable type never embeds). Keep them identical (ADR-0034) — this fails CI if they diverge.
  it('the embeddable extension list matches the storable/MIME extension set', () => {
    expect([...ASSET_EXTENSIONS].sort()).toEqual(ASSET_EMBED_EXTENSIONS.map((e) => `.${e}`).sort());
  });
});

/** A tiny valid-enough PNG header; content is irrelevant, only its bytes' identity matters. */
const PNG_A = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PNG_B = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 8, 7]);

describe('AssetsService', () => {
  let db: Db;
  let dir: string;
  let assets: AssetsService;

  beforeEach(() => {
    db = createDb(':memory:');
    dir = mkdtempSync(join(tmpdir(), 'hexly-assets-test-'));
    assets = new AssetsService(db, dir, new EntityDeletionRegistry());
    db.$client
      .prepare("INSERT INTO containers (id, kind, name, created_at, updated_at) VALUES (?,'world',?,0,0)")
      .run('world-1', 'W');
    db.$client.prepare('INSERT INTO worlds (id) VALUES (?)').run('world-1');
  });

  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * Seed an Asset Entity for a stored file: an `entities` row carrying the asset-ref at the
   * `core.field.asset` key, plus the derived `asset_index` row the write choke point would materialise
   * (ADR-0065) — the index list/export enumerate Asset Entities through.
   */
  function seedAsset(worldId: string, entityId: string, name: string, hash: string, ext: string, size: number): void {
    const doc = JSON.stringify({ 'core.field.asset': { hash, ext, mime: 'image/png', size, stats: null } });
    db.$client
      .prepare(
        `INSERT INTO entities (id, container_id, name, types, tags, visibility, version, seq, document, created_at, updated_at)
         VALUES (?,?,?,?,?,?,1,1,?,?,?)`,
      )
      .run(entityId, worldId, name, JSON.stringify(['core.type.asset']), '[]', 'shared', doc, 0, 0);
    db.$client
      .prepare('INSERT INTO asset_index (entity_id, container_id, hash) VALUES (?,?,?)')
      .run(entityId, worldId, hash);
  }

  it('stores bytes content-addressed on disk, deduping a repeat by hash (no table, ADR-0065)', () => {
    const first = assets.store('world-1', 'Portrait.png', PNG_A);

    // URL is the capability path Content will reference (ADR-0034).
    expect(first.url).toBe(`/assets/world-1/${first.hash}.png`);
    expect(first.mime).toBe('image/png');
    expect(first.ext).toBe('.png');

    // Bytes land on disk under the World folder, named by hash + original extension.
    const onDisk = join(dir, 'world-1', `${first.hash}.png`);
    expect(existsSync(onDisk)).toBe(true);
    expect(new Uint8Array(readFileSync(onDisk))).toEqual(PNG_A);

    // The same bytes hash the same, so a repeat writes one byte-identical file — no twin on disk.
    const again = assets.store('world-1', 'copy.png', PNG_A);
    expect(again.hash).toBe(first.hash);
    expect(readdirSync(join(dir, 'world-1'))).toHaveLength(1);

    // Different bytes hash differently and store separately.
    const other = assets.store('world-1', 'Map.png', PNG_B);
    expect(other.hash).not.toBe(first.hash);
    expect(readdirSync(join(dir, 'world-1'))).toHaveLength(2);
  });

  it('pins an empty extension for an extension-less upload, which still addresses a file', () => {
    const stored = assets.store('world-1', 'Untitled', PNG_A);

    // `''` is a value, not an absence: the bytes land under the bare hash and the capability URL reaches
    // them, which is why every reader of `ext` tests it for absence rather than for truth (#416).
    expect(stored.ext).toBe('');
    expect(stored.url).toBe(`/assets/world-1/${stored.hash}`);
    expect(existsSync(join(dir, 'world-1', stored.hash))).toBe(true);
    expect(assets.read('world-1', stored.hash)).not.toBeNull();
  });

  describe('thumbnails (a regenerable cache beside the bytes, ADR-0065)', () => {
    const THUMB = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3]); // stand-in WebP bytes

    it('stores a thumbnail at the hash-derived path and serves it on the same route', () => {
      const stored = assets.store('world-1', 'Portrait.png', PNG_A);
      assets.storeThumbnail('world-1', stored.hash, THUMB);

      const served = assets.read('world-1', `${stored.hash}.thumb.webp`);
      expect(served?.mime).toBe('image/webp');
      expect(served && new Uint8Array(served.bytes)).toEqual(THUMB);
    });

    it('falls back to the original bytes when a thumbnail was never minted', () => {
      const stored = assets.store('world-1', 'Portrait.png', PNG_A);
      // No storeThumbnail (a non-image, or bytes sharp could not parse): the thumb URL serves the original.
      const served = assets.read('world-1', `${stored.hash}.thumb.webp`);
      expect(served?.mime).toBe('image/png');
      expect(served && new Uint8Array(served.bytes)).toEqual(PNG_A);
    });

    it('still 404s a thumbnail request whose source Asset does not exist', () => {
      expect(assets.read('world-1', `${'a'.repeat(64)}.thumb.webp`)).toBeNull();
    });
  });

  describe('exportAssets (the vault export source, ADR-0033/ADR-0065)', () => {
    it('reads each Asset Entity’s bytes under its name + extension', () => {
      const portrait = assets.store('world-1', 'Portrait.png', PNG_A);
      seedAsset('world-1', 'asset-1', 'Portrait', portrait.hash, '.png', PNG_A.length);

      expect(assets.exportAssets('world-1')).toEqual([
        {
          servedUrl: portrait.url,
          originalFilename: 'Portrait.png',
          bytes: expect.any(Buffer),
        },
      ]);
      expect(new Uint8Array(assets.exportAssets('world-1')[0].bytes)).toEqual(PNG_A);
    });

    it('skips an Asset Entity in Missing Bytes rather than aborting', () => {
      seedAsset('world-1', 'asset-1', 'Ghost', 'a'.repeat(64), '.png', 3);
      expect(assets.exportAssets('world-1')).toEqual([]);
    });

    describe('the foreign bytes a document draws on (ADR-0080, #415)', () => {
      /** The shelf `world-1` draws from, and two of its notes to source edges from. */
      beforeEach(() => {
        db.$client
          .prepare("INSERT INTO containers (id, kind, name, created_at, updated_at) VALUES (?,'world',?,0,0)")
          .run('shelf-1', 'S');
        db.$client.prepare('INSERT INTO worlds (id) VALUES (?)').run('shelf-1');
        for (const [id, name] of [
          ['note-1', 'Hero'],
          ['note-2', 'The Lair'],
        ])
          db.$client
            .prepare(
              `INSERT INTO entities (id, container_id, name, types, tags, visibility, version, seq, document, created_at, updated_at)
               VALUES (?,?,?,?,?,?,1,1,?,?,?)`,
            )
            .run(id, 'world-1', name, JSON.stringify(['core.type.note']), '[]', 'private', '{}', 0, 0);
      });

      /** The `asset` edge a prose image mints: the source's Container, and the one its URL named (#407). */
      function seedAssetEdge(sourceEntityId: string, targetContainerId: string, hash: string): void {
        db.$client
          .prepare(
            `INSERT INTO entity_edges (source_entity_id, container_id, target_kind, target_id, target_container_id, decor)
             VALUES (?,'world-1','asset',?,?,1)`,
          )
          .run(sourceEntityId, hash, targetContainerId);
      }

      /** An Asset Entity on the shelf, stored and indexed there — what a mounted image resolves to. */
      function seedShelfAsset(name: string, bytes: Uint8Array): string {
        const stored = assets.store('shelf-1', `${name}.png`, bytes);
        seedAsset('shelf-1', `shelf-${name}`, name, stored.hash, '.png', bytes.length);
        return stored.hash;
      }

      it("reads the bytes from the Container the edge's URL named, not the referencing World's", () => {
        const hash = seedShelfAsset('Portrait', PNG_A);
        seedAssetEdge('note-1', 'shelf-1', hash);

        const exported = assets.exportAssets('world-1');
        expect(exported).toEqual([
          { servedUrl: `/assets/shelf-1/${hash}.png`, originalFilename: 'Portrait.png', bytes: expect.any(Buffer) },
        ]);
        expect(new Uint8Array(exported[0].bytes)).toEqual(PNG_A);
      });

      it("writes the World's own Assets first, so what it holds is never displaced by what it draws on", () => {
        const own = assets.store('world-1', 'Portrait.png', PNG_A);
        seedAsset('world-1', 'asset-1', 'Portrait', own.hash, '.png', PNG_A.length);
        // The same human-readable name on both sides — the collision the export's uniquePath resolves.
        const foreign = seedShelfAsset('Portrait', PNG_B);
        seedAssetEdge('note-1', 'shelf-1', foreign);

        expect(assets.exportAssets('world-1').map((a) => a.servedUrl)).toEqual([
          `/assets/world-1/${own.hash}.png`,
          `/assets/shelf-1/${foreign}.png`,
        ]);
      });

      it('counts a World’s own Asset once, however many of its edges point at it', () => {
        const own = assets.store('world-1', 'Portrait.png', PNG_A);
        seedAsset('world-1', 'asset-1', 'Portrait', own.hash, '.png', PNG_A.length);
        seedAssetEdge('note-1', 'world-1', own.hash);

        expect(assets.exportAssets('world-1')).toHaveLength(1);
      });

      it('yields one entry however many documents reference the same foreign image', () => {
        const hash = seedShelfAsset('Portrait', PNG_A);
        seedAssetEdge('note-1', 'shelf-1', hash);
        seedAssetEdge('note-2', 'shelf-1', hash);

        expect(assets.exportAssets('world-1')).toHaveLength(1);
      });

      it('leaves out a foreign image in Missing Bytes rather than failing the export', () => {
        // Indexed on the shelf, but nothing on disk — an unmounted volume, a relocated Assets root.
        seedAsset('shelf-1', 'shelf-ghost', 'Ghost', 'a'.repeat(64), '.png', 3);
        seedAssetEdge('note-1', 'shelf-1', 'a'.repeat(64));

        expect(assets.exportAssets('world-1')).toEqual([]);
      });

      it('drops an edge naming no Asset in that Container — already dangling, nothing to flatten', () => {
        seedAssetEdge('note-1', 'shelf-1', 'b'.repeat(64));
        expect(assets.exportAssets('world-1')).toEqual([]);
      });

      it('ignores an entity edge, whose target Container is the source’s own', () => {
        const hash = seedShelfAsset('Portrait', PNG_A);
        db.$client
          .prepare(
            `INSERT INTO entity_edges (source_entity_id, container_id, target_kind, target_id, target_container_id, decor)
             VALUES (?,'world-1','entity',?,NULL,0)`,
          )
          .run('note-1', hash);

        expect(assets.exportAssets('world-1')).toEqual([]);
      });
    });
  });
});
