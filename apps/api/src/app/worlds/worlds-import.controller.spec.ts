import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { strToU8, zipSync, type Zippable } from 'fflate';
import request from 'supertest';
import { DB, Db, createDb } from '../db/db';
import { AuthService } from '../auth/auth.service';
import { AuthModule } from '../auth/auth.module';
import { EntitiesModule } from '../entities/entities.module';
import { WorldsModule } from './worlds.module';

/** Build an in-memory `.zip` from a vault-relative path → text (or raw bytes) map. */
function vaultZip(files: Record<string, string | Uint8Array>): Buffer {
  const entries: Zippable = {};
  for (const [path, data] of Object.entries(files)) {
    entries[path] = typeof data === 'string' ? strToU8(data) : data;
  }
  return Buffer.from(zipSync(entries));
}

describe('Vault import endpoint', () => {
  let app: INestApplication;
  let db: Db;

  beforeEach(async () => {
    db = createDb(':memory:'); // Isolated per-test (ADR-0002).
    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule, WorldsModule, EntitiesModule],
    })
      .overrideProvider(DB)
      .useValue(db)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    await app.get(AuthService).seedUser('ada@hexly.test', 'correct horse', 'Ada');
  });

  afterEach(async () => {
    await app.close();
  });

  async function signIn(email: string, password: string) {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/auth/login').send({ email, password }).expect(200);
    return agent;
  }

  it('imports a vault .zip into a new World named after the file, one note per markdown file', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const zip = vaultZip({ 'Lady Mara.md': '# Lady Mara\n\nA ranger of the north.' });

    const res = await ada
      .post('/worlds/import')
      .attach('file', zip, 'Aldermoor.zip')
      .expect(201);

    expect(res.body).toMatchObject({
      worldId: expect.any(String),
      notesImported: 1,
      filesSkipped: 0,
    });

    // World is named after the uploaded file (sans .zip).
    const world = await ada.get(`/worlds/${res.body.worldId}`).expect(200);
    expect(world.body.name).toBe('Aldermoor');

    // The markdown file became a `note` named after its filename (Home + note = 2).
    const list = await ada
      .get(`/entities?worldId=${res.body.worldId}`)
      .expect(200);
    const mara = list.body.items.find((e: { name: string }) => e.name === 'Lady Mara');
    expect(mara).toBeDefined();
    expect(mara.type).toBe('note');
  });

  it('preserves the folder path as hexly.sourcePath, frontmatter as Metadata, and tags as Hexly Tags', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const zip = vaultZip({
      'Characters/Lady Mara.md': [
        '---',
        'tags: [Deity, ruined]',
        'aliases: [Mara, The Ranger]',
        'status: alive',
        '---',
        '# Lady Mara',
        '',
        'A ranger.',
      ].join('\n'),
    });

    const res = await ada
      .post('/worlds/import')
      .attach('file', zip, 'Aldermoor.zip')
      .expect(201);

    const list = await ada.get(`/entities?worldId=${res.body.worldId}`).expect(200);
    const summary = list.body.items.find((e: { name: string }) => e.name === 'Lady Mara');

    // Frontmatter tags become Hexly Tags, normalized (lower-cased, deduped).
    expect(summary.tags).toEqual(['deity', 'ruined']);

    const mara = await ada.get(`/entities/${summary.id}`).expect(200);
    // Body converted to the opaque tiptap-v3 snapshot (ADR-0019).
    expect(mara.body.document.content.format).toBe('tiptap-v3');
    expect(mara.body.document.content.snapshot.type).toBe('doc');

    // Folder path preserved under the reserved namespace; frontmatter (incl. aliases)
    // passes through as Metadata; `tags` moved out to Hexly Tags (not left in Metadata).
    expect(mara.body.document.metadata).toEqual({
      'hexly.sourcePath': 'Characters/Lady Mara.md',
      aliases: ['Mara', 'The Ranger'],
      status: 'alive',
    });
  });

  it('reports dangling links, degraded constructs, and zero assets in the summary', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const zip = vaultZip({
      'Keep.md': 'Guarded by [[Lady Mara]] and the [[Watch]].[^1]\n\n[^1]: A footnote.',
    });

    const res = await ada
      .post('/worlds/import')
      .attach('file', zip, 'Aldermoor.zip')
      .expect(201);

    // Wikilinks are dangling this slice (resolution is the next one); no assets yet.
    expect(res.body.linksResolved).toBe(0);
    expect(res.body.linksDangling).toBe(2);
    expect(res.body.assetsStored).toBe(0);
    // A construct with no native node (the footnote) is degraded and tallied, not silently lost.
    expect(res.body.constructsDegraded).toEqual({ footnote: 1 });
  });

  it('ignores .obsidian config and non-note files, importing only markdown', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const zip = vaultZip({
      'Lady Mara.md': '# Lady Mara',
      '.obsidian/app.json': '{ "theme": "dark" }',
      'attachments/portrait.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    });

    const res = await ada
      .post('/worlds/import')
      .attach('file', zip, 'Aldermoor.zip')
      .expect(201);

    expect(res.body.notesImported).toBe(1);
    // World holds only its Home Entity plus the one imported note.
    const world = await ada.get(`/worlds/${res.body.worldId}`).expect(200);
    expect(world.body.entityCount).toBe(2);
    const list = await ada.get(`/entities?worldId=${res.body.worldId}`).expect(200);
    const names = list.body.items.map((e: { name: string }) => e.name);
    expect(names).not.toContain('app');
    expect(names).not.toContain('portrait');
  });

  it('skips an unreadable file and reports it, still importing the rest', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const zip = vaultZip({
      'Good.md': '# Good note',
      // Invalid UTF-8 bytes: strict decode throws, so the file is skipped, not mojibake'd.
      'Broken.md': new Uint8Array([0xff, 0xfe, 0xfd]),
    });

    const res = await ada
      .post('/worlds/import')
      .attach('file', zip, 'Aldermoor.zip')
      .expect(201);

    expect(res.body.notesImported).toBe(1);
    expect(res.body.filesSkipped).toBe(1);

    const list = await ada.get(`/entities?worldId=${res.body.worldId}`).expect(200);
    const names = list.body.items.map((e: { name: string }) => e.name);
    expect(names).toContain('Good');
    expect(names).not.toContain('Broken');
  });

  it('rejects a non-zip upload with 400 and mints no orphan World', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const before = (await ada.get('/worlds').expect(200)).body.length;

    await ada
      .post('/worlds/import')
      .attach('file', Buffer.from('not a zip at all'), 'Aldermoor.zip')
      .expect(400);

    // The World is minted only after the archive decompresses, so a bad upload leaves nothing.
    const after = (await ada.get('/worlds').expect(200)).body.length;
    expect(after).toBe(before);
  });

  it('falls back to a valid World name when the filename is blank/whitespace', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const zip = vaultZip({ 'Note.md': '# Note' });

    const res = await ada
      .post('/worlds/import')
      .attach('file', zip, '   .zip') // strips to whitespace — must not name the World "   "
      .expect(201);

    const world = await ada.get(`/worlds/${res.body.worldId}`).expect(200);
    expect(world.body.name).toBe('Imported Vault');
  });

  it('refuses the import route without a session cookie', async () => {
    await request(app.getHttpServer()).post('/worlds/import').expect(401);
  });
});
