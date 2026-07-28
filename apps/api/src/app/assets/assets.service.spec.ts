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
        `INSERT INTO entities (id, world_id, name, types, tags, visibility, version, seq, document, created_at, updated_at)
         VALUES (?,?,?,?,?,?,1,1,?,?,?)`,
      )
      .run(entityId, worldId, name, JSON.stringify(['core.type.asset']), '[]', 'shared', doc, 0, 0);
    db.$client
      .prepare('INSERT INTO asset_index (entity_id, world_id, hash) VALUES (?,?,?)')
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

  describe('summariesFor (the picker source, #269, #281, ADR-0065)', () => {
    it('returns an empty list when the entity-search matched nothing', () => {
      expect(assets.summariesFor('world-1', [])).toEqual([]);
    });

    it('dresses each matched Asset Entity as an AssetSummary with its url, thumbnail, mime and size', () => {
      const portrait = assets.store('world-1', 'Portrait.png', PNG_A);
      seedAsset('world-1', 'asset-1', 'Portrait', portrait.hash, '.png', PNG_A.length);

      const summaries = assets.summariesFor('world-1', [{ id: 'asset-1', name: 'Portrait' }]);
      expect(summaries).toEqual([
        {
          url: portrait.url,
          // The hash-derived thumbnail URL (ADR-0065); the serving route falls back to the original.
          thumbnailUrl: `/assets/world-1/${portrait.hash}.thumb.webp`,
          // The Entity's name (as the search returned it) + its ref's pinned extension — a rename relabels
          // this, never the URL.
          originalFilename: 'Portrait.png',
          mime: 'image/png',
          size: PNG_A.length,
        },
      ]);
      // Metadata only — no hash leak to the summary.
      expect(summaries[0]).not.toHaveProperty('hash');
    });

    it('preserves the search order the caller passed (relevance is authoritative, ADR-0065)', () => {
      const a = assets.store('world-1', 'Portrait.png', PNG_A);
      const b = assets.store('world-1', 'Map.png', PNG_B);
      seedAsset('world-1', 'asset-a', 'Portrait', a.hash, '.png', PNG_A.length);
      seedAsset('world-1', 'asset-b', 'Map', b.hash, '.png', PNG_B.length);

      // Pass them B-then-A: the summaries come back in exactly that order, never re-sorted here.
      expect(
        assets
          .summariesFor('world-1', [
            { id: 'asset-b', name: 'Map' },
            { id: 'asset-a', name: 'Portrait' },
          ])
          .map((s) => s.originalFilename),
      ).toEqual(['Map.png', 'Portrait.png']);
    });

    it('drops a match whose Entity is gone (no readable asset-ref) rather than emitting a broken tile', () => {
      const portrait = assets.store('world-1', 'Portrait.png', PNG_A);
      seedAsset('world-1', 'asset-1', 'Portrait', portrait.hash, '.png', PNG_A.length);

      // 'ghost' has no entities row, so no readable ref — it is skipped forward-only.
      expect(
        assets
          .summariesFor('world-1', [
            { id: 'ghost', name: 'Ghost' },
            { id: 'asset-1', name: 'Portrait' },
          ])
          .map((s) => s.originalFilename),
      ).toEqual(['Portrait.png']);
    });
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

    it('skips an Asset Entity whose bytes are missing on disk rather than aborting', () => {
      seedAsset('world-1', 'asset-1', 'Ghost', 'a'.repeat(64), '.png', 3);
      expect(assets.exportAssets('world-1')).toEqual([]);
    });
  });
});
