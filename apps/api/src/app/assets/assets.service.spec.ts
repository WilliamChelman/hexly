import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASSET_EMBED_EXTENSIONS } from '@hexly/plugin-content';
import { createDb, Db } from '../db/db';
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
    db = createDb(':memory:'); // migrations run at boot, incl. the new assets table.
    dir = mkdtempSync(join(tmpdir(), 'hexly-assets-test-'));
    assets = new AssetsService(db, dir);
    // assets.world_id FKs to a real World; seed one (ADR-0037: no owner_id column).
    db.$client.prepare('INSERT INTO worlds (id, name, created_at, updated_at) VALUES (?,?,0,0)').run('world-1', 'W');
  });

  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('stores bytes content-addressed on disk and rows them, deduping a repeat', () => {
    const first = assets.store('world-1', 'Portrait.png', PNG_A);

    // URL is the capability path Content will reference (ADR-0034).
    expect(first.url).toBe(`/assets/world-1/${first.hash}.png`);
    expect(first.deduped).toBe(false);

    // Bytes land on disk under the World folder, named by hash + original extension.
    const onDisk = join(dir, 'world-1', `${first.hash}.png`);
    expect(existsSync(onDisk)).toBe(true);
    expect(new Uint8Array(readFileSync(onDisk))).toEqual(PNG_A);

    // EntityDocument is rowed (original filename kept for export, ADR-0034).
    const rows = db.$client.prepare('SELECT * FROM assets WHERE world_id = ?').all('world-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      hash: first.hash,
      original_filename: 'Portrait.png',
      mime: 'image/png',
      size: PNG_A.length,
    });

    // The same bytes, referenced again, store once: same hash, deduped, still one file/row.
    const again = assets.store('world-1', 'copy.png', PNG_A);
    expect(again.hash).toBe(first.hash);
    expect(again.deduped).toBe(true);
    expect(readdirSync(join(dir, 'world-1'))).toHaveLength(1);
    expect(db.$client.prepare('SELECT count(*) c FROM assets WHERE world_id = ?').get('world-1')).toMatchObject({
      c: 1,
    });

    // Different bytes hash differently and store separately.
    const other = assets.store('world-1', 'Map.png', PNG_B);
    expect(other.hash).not.toBe(first.hash);
    expect(readdirSync(join(dir, 'world-1'))).toHaveLength(2);
  });

  describe('list (the picker source, #269)', () => {
    it('returns an empty list for a World with no Assets', () => {
      expect(assets.list('world-1')).toEqual([]);
    });

    it('summarizes every stored Asset with its capability url, mime and size', () => {
      const portrait = assets.store('world-1', 'Portrait.png', PNG_A);
      assets.store('world-1', 'notes.pdf', PNG_B);

      const summaries = assets.list('world-1');
      expect(summaries).toContainEqual({
        url: portrait.url,
        originalFilename: 'Portrait.png',
        mime: 'image/png',
        size: PNG_A.length,
      });
      // The pdf's mime comes from the row, not a URL re-derivation.
      expect(summaries.find((a) => a.originalFilename === 'notes.pdf')?.mime).toBe('application/pdf');
      // Metadata only — no hash/deduped leak to the summary.
      expect(summaries[0]).not.toHaveProperty('hash');
    });

    it('lists a World in isolation — a sibling World’s Assets never bleed in', () => {
      db.$client.prepare('INSERT INTO worlds (id, name, created_at, updated_at) VALUES (?,?,0,0)').run('world-2', 'W2');
      assets.store('world-1', 'Portrait.png', PNG_A);
      assets.store('world-2', 'Map.png', PNG_B);

      expect(assets.list('world-1').map((a) => a.originalFilename)).toEqual(['Portrait.png']);
    });

    it('orders by createdAt then hash for a stable list', () => {
      // Two rows with the same createdAt fall back to the hash tiebreak; a stray older row sorts first.
      assets.store('world-1', 'Second.png', PNG_A);
      assets.store('world-1', 'First.png', PNG_B);
      db.$client.prepare('UPDATE assets SET created_at = ? WHERE original_filename = ?').run(1, 'First.png');
      db.$client.prepare('UPDATE assets SET created_at = ? WHERE original_filename = ?').run(2, 'Second.png');

      expect(assets.list('world-1').map((a) => a.originalFilename)).toEqual(['First.png', 'Second.png']);
    });
  });
});
