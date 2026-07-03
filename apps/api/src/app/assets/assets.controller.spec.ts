import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createDb, DB, Db } from '../db/db';
import { AssetsModule } from './assets.module';
import { ASSETS_DIR, AssetsService } from './assets.service';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe('Asset serving endpoint', () => {
  let app: INestApplication;
  let db: Db;
  let dir: string;

  beforeEach(async () => {
    db = createDb(':memory:');
    dir = mkdtempSync(join(tmpdir(), 'hexly-assets-ctl-'));
    const moduleRef = await Test.createTestingModule({ imports: [AssetsModule] })
      .overrideProvider(DB)
      .useValue(db)
      .overrideProvider(ASSETS_DIR)
      .useValue(dir)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db.$client.prepare('INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,0)').run('u1', 'a@b.c', 'A', 'h');
    db.$client.prepare('INSERT INTO worlds (id, name, owner_id, created_at, updated_at) VALUES (?,?,?,0,0)').run('world-1', 'W', 'u1');
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
    await request(app.getHttpServer())
      .get('/assets/world-1/deadbeef.png')
      .expect(404);
  });

  it('refuses a path-traversal filename rather than escaping the world folder', async () => {
    await request(app.getHttpServer())
      .get('/assets/world-1/..%2f..%2fhexly.db')
      .expect((res) => {
        if (res.status === 200) throw new Error('traversal served a file');
      });
  });
});
