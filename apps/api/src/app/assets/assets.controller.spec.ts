import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createDb, DB, Db } from '../db/db';
import { ConfigModule } from '../config/config.module';
import { EntitiesService } from '../entities/entities.service';
import { AssetMintService } from './asset-mint.service';
import { AssetsModule } from './assets.module';
import { ASSETS_DIR, AssetsService } from './assets.service';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/** The one user and World every case here uploads into. */
function seedUserAndWorld(db: Db): void {
  db.$client
    .prepare('INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,0)')
    .run('u1', 'a@b.c', 'A', 'h');
  db.$client.prepare('INSERT INTO worlds (id, name, created_at, updated_at) VALUES (?,?,0,0)').run('world-1', 'W');
}

describe('Asset serving endpoint', () => {
  let app: INestApplication;
  let db: Db;
  let dir: string;

  beforeEach(async () => {
    db = createDb(':memory:');
    dir = mkdtempSync(join(tmpdir(), 'hexly-assets-ctl-'));
    const moduleRef = await Test.createTestingModule({
      // AssetsModule pulls in the Entity write graph for mint-and-dedup (ADR-0065), whose NudgeBus
      // needs the Instance Configuration — so the serving test composes ConfigModule too.
      imports: [ConfigModule, AssetsModule],
    })
      .overrideProvider(DB)
      .useValue(db)
      .overrideProvider(ASSETS_DIR)
      .useValue(dir)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    seedUserAndWorld(db);
  });

  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves stored bytes with no authentication and the right content type', async () => {
    const { url } = app.get(AssetsService).store('world-1', 'Portrait.png', PNG);

    // No cookie, no guard: the unguessable hash is the only access control (ADR-0034).
    const res = await request(app.getHttpServer()).get(url).expect(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(new Uint8Array(res.body)).toEqual(PNG);
  });

  it('404s an unknown asset', async () => {
    await request(app.getHttpServer()).get('/assets/world-1/deadbeef.png').expect(404);
  });

  it('refuses a path-traversal filename rather than escaping the world folder', async () => {
    await request(app.getHttpServer())
      .get('/assets/world-1/..%2f..%2fhexly.db')
      .expect((res) => {
        if (res.status === 200) throw new Error('traversal served a file');
      });
  });
});

/**
 * `assets.dir` end-to-end (ADR-0034 amendment, ADR-0070): `hexly.yml` → the `ASSETS_DIR` seam → where an
 * upload's bytes land and what the capability URL serves. Composed over a real throwaway Instance
 * Directory with `ASSETS_DIR` *not* overridden, because the wiring is the thing under test.
 */
describe('Asset bytes root from hexly.yml (ADR-0070)', () => {
  const originalDir = process.env.HEXLY_DIR;
  let app: INestApplication;
  let instanceDir: string;

  /** Boot over a fresh Instance Directory carrying `yml` (none when absent), and seed a World to upload into. */
  async function boot(yml?: string): Promise<void> {
    instanceDir = mkdtempSync(join(tmpdir(), 'hexly-assets-instance-'));
    if (yml !== undefined) writeFileSync(join(instanceDir, 'hexly.yml'), yml);
    process.env.HEXLY_DIR = instanceDir;
    const db = createDb(':memory:');
    const moduleRef = await Test.createTestingModule({ imports: [ConfigModule, AssetsModule] })
      .overrideProvider(DB)
      .useValue(db)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    seedUserAndWorld(db);
  }

  /** Mint an Asset from uploaded bytes — what the upload route does behind multer — and hand back its URL. */
  async function mintUpload(filename: string): Promise<string> {
    const mint = app.get(AssetMintService);
    const { url } = mint.mint('u1', 'world-1', filename, PNG, await mint.extract(filename, PNG));
    return url;
  }

  afterEach(async () => {
    await app.close();
    rmSync(instanceDir, { recursive: true, force: true });
    if (originalDir === undefined) delete process.env.HEXLY_DIR;
    else process.env.HEXLY_DIR = originalDir;
  });

  it('lands an upload under a configured absolute root and still serves it from the capability URL', async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'hexly-assets-elsewhere-'));
    await boot(`assets:\n  dir: ${elsewhere}\n`);

    const url = await mintUpload('Portrait.png');

    const res = await request(app.getHttpServer()).get(url).expect(200);
    expect(new Uint8Array(res.body)).toEqual(PNG);
    // The bytes are on the configured volume, and nothing was written beside the database.
    expect(existsSync(join(elsewhere, 'world-1', `${url.split('/').pop()}`))).toBe(true);
    expect(existsSync(join(instanceDir, 'assets'))).toBe(false);
    rmSync(elsewhere, { recursive: true, force: true });
  });

  it('keeps writing to the `assets` folder beside the database when the file names no root — no migration', async () => {
    await boot();

    const url = await mintUpload('Portrait.png');

    await request(app.getHttpServer()).get(url).expect(200);
    expect(existsSync(join(instanceDir, 'assets', 'world-1'))).toBe(true);
  });
});

/**
 * Missing Asset bytes (#325, ADR-0034 amendment). Changing `assets.dir` moves no existing bytes, and an
 * external volume can be unmounted — so bytes go absent while the Entity, its Stats and its prose stay
 * perfectly intact. The read model must be able to say which of the two happened, and say it live: the state
 * is one stat off the address the dedup index already holds, so restoring the file heals it with no Reindex.
 */
describe('Missing Asset bytes (#325)', () => {
  let app: INestApplication;
  let db: Db;
  let dir: string;

  beforeEach(async () => {
    db = createDb(':memory:');
    dir = mkdtempSync(join(tmpdir(), 'hexly-assets-missing-'));
    const moduleRef = await Test.createTestingModule({ imports: [ConfigModule, AssetsModule] })
      .overrideProvider(DB)
      .useValue(db)
      .overrideProvider(ASSETS_DIR)
      .useValue(dir)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    seedUserAndWorld(db);
  });

  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  /** Mint an Asset the ordinary way and hand back its id plus the on-disk path of its bytes. */
  async function mintAsset(): Promise<{ id: string; bytesPath: string }> {
    const mint = app.get(AssetMintService);
    const { entity } = mint.mint('u1', 'world-1', 'Portrait.png', PNG, await mint.extract('Portrait.png', PNG));
    const ref = entity.document['core.field.asset'] as { hash: string; ext: string };
    return { id: entity.id, bytesPath: join(dir, 'world-1', ref.hash + ref.ext) };
  }

  it('marks the Asset missing once its bytes leave the root, and unmarks it when they come back', async () => {
    const { id, bytesPath } = await mintAsset();
    const entities = app.get(EntitiesService);

    // A healthy Asset carries no flag at all — visually unchanged from before this state existed.
    expect(entities.load('u1', id)?.assetBytesMissing).toBeUndefined();

    rmSync(bytesPath);
    expect(entities.load('u1', id)?.assetBytesMissing).toBe(true);

    // Restoring the file clears it on the next read — no Reindex, because nothing derived went stale.
    writeFileSync(bytesPath, PNG);
    expect(entities.load('u1', id)?.assetBytesMissing).toBeUndefined();
  });

  it('marks it on the thumbnail-bearing list read too — the Asset Browser draws its grid off that', async () => {
    const { id, bytesPath } = await mintAsset();
    const entities = app.get(EntitiesService);
    // Exactly the read the Asset Browser issues: the type facet pinned to the asset type (which is
    // hidden-from-default-listing, ADR-0065) and thumbnails opted in.
    const tileFor = () =>
      entities
        .list('u1', {
          offset: 0,
          limit: 10,
          worldId: 'world-1',
          type: ['core.type.asset'],
          withThumbnails: true,
        })
        .items.find((item) => item.id === id);

    expect(tileFor()).toBeDefined();
    expect(tileFor()?.assetBytesMissing).toBeUndefined();

    rmSync(bytesPath);
    expect(tileFor()?.assetBytesMissing).toBe(true);
    // The thumbnail URL still resolves off the index — the state is what tells the grid not to draw it.
    expect(tileFor()?.thumbnailUrl).toBeDefined();
  });

  it('keeps saying so through a save and a rename — a write response replaces the client’s open Entity', async () => {
    const { id, bytesPath } = await mintAsset();
    const entities = app.get(EntitiesService);
    const open = entities.load('u1', id);
    if (!open) throw new Error('minted Asset did not load');

    rmSync(bytesPath);

    // Autosave on the Asset's prose: the client holds this response as `current`, so a bare detail here
    // would unsay the state while the file is still gone.
    const saved = entities.save('u1', id, { document: open.document, version: open.version });
    expect(saved.status).toBe('saved');
    expect(saved.status === 'saved' && saved.entity.assetBytesMissing).toBe(true);

    expect(entities.patch('u1', id, { name: 'Renamed' })?.assetBytesMissing).toBe(true);
  });

  it('never cries missing over the thumbnail cache alone — only the original answers the question', async () => {
    const { id } = await mintAsset();
    const entities = app.get(EntitiesService);

    // A thumbnail is regenerable and may never have existed (a PDF, bytes sharp could not parse); losing it
    // must not read as "your file is gone", because the serving route falls back to the original.
    const hash = (entities.load('u1', id)?.document['core.field.asset'] as { hash: string }).hash;
    rmSync(join(dir, 'world-1', `${hash}.thumb.webp`), { force: true });

    expect(entities.load('u1', id)?.assetBytesMissing).toBeUndefined();
  });
});
