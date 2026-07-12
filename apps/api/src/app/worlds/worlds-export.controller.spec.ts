import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { parse as parseYaml } from 'yaml';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { emptyEntityBody, tiptapContent } from '@hexly/domain';
import { DB, Db, createDb } from '../db/db';
import { worldMembers } from '../db/schema';
import { EntitiesService } from '../entities/entities.service';
import { ASSETS_DIR } from '../assets/assets.service';
import { AuthService } from '../auth/auth.service';
import { AuthModule } from '../auth/auth.module';
import { EntitiesModule } from '../entities/entities.module';
import { ConfigModule } from '../config/config.module';
import { WorldsModule } from './worlds.module';

/** Build an in-memory `.zip` from a vault-relative path → text (or raw bytes) map. */
function vaultZip(files: Record<string, string | Uint8Array>): Buffer {
  const entries: Zippable = {};
  for (const [path, data] of Object.entries(files)) {
    entries[path] = typeof data === 'string' ? strToU8(data) : data;
  }
  return Buffer.from(zipSync(entries));
}

/** Decode a zip entry's bytes as UTF-8 text. */
function text(files: Record<string, Uint8Array>, path: string): string {
  return new TextDecoder('utf-8').decode(files[path]);
}

/** Parse a markdown file's leading YAML frontmatter block, or {} if it has none. */
function frontmatter(md: string): Record<string, unknown> {
  const match = /^---\n([\s\S]*?)\n---/.exec(md);
  return match ? (parseYaml(match[1]) ?? {}) : {};
}

describe('Vault export endpoint', () => {
  let app: INestApplication;
  let db: Db;
  let assetsDir: string;
  let adaId: string;

  beforeEach(async () => {
    db = createDb(':memory:'); // Isolated per-test (ADR-0002).
    assetsDir = mkdtempSync(join(tmpdir(), 'hexly-export-assets-'));
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, AuthModule, WorldsModule, EntitiesModule],
    })
      .overrideProvider(DB)
      .useValue(db)
      .overrideProvider(ASSETS_DIR)
      .useValue(assetsDir)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    adaId = await app.get(AuthService).seedUser('ada@hexly.test', 'correct horse', 'Ada', {
      roles: ['create-worlds'],
    });
  });

  afterEach(async () => {
    await app.close();
    rmSync(assetsDir, { recursive: true, force: true });
  });

  async function signIn(email: string, password: string) {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/auth/login').send({ email, password }).expect(200);
    return agent;
  }

  /** Import a vault to seed a World, returning its id. */
  async function importVault(
    agent: request.Agent,
    files: Record<string, string | Uint8Array>,
    filename = 'Aldermoor.zip',
  ): Promise<string> {
    const res = await agent.post('/worlds/import').attach('file', vaultZip(files), filename).expect(201);
    return res.body.worldId;
  }

  /** Export a World and return the raw response plus its unzipped entries. */
  async function exportZip(agent: request.Agent, worldId: string) {
    const res = await agent.get(`/worlds/${worldId}/export`).responseType('blob').expect(200);
    return { res, files: unzipSync(new Uint8Array(res.body)) };
  }

  it('exports a note as <name>.md in a streamed .zip', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const worldId = await importVault(ada, {
      'Lady Mara.md': '# Lady Mara\n\nA ranger of the north.',
    });

    const { res, files } = await exportZip(ada, worldId);

    expect(res.headers['content-type']).toMatch(/application\/zip/);
    expect(files).toHaveProperty('Lady Mara.md');
    expect(text(files, 'Lady Mara.md')).toContain('# Lady Mara');
    expect(text(files, 'Lady Mara.md')).toContain('A ranger of the north.');
  });

  it('rebuilds the folder tree from hexly.sourcePath and never emits hexly.* as frontmatter', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const worldId = await importVault(ada, {
      'Characters/Heroes/Lady Mara.md': '# Lady Mara\n\nA ranger.',
    });

    const { files } = await exportZip(ada, worldId);

    // Placed back under its original folder as <name>.md.
    expect(files).toHaveProperty('Characters/Heroes/Lady Mara.md');
    // The reserved provenance key is consumed for placement, not written back to frontmatter.
    expect(text(files, 'Characters/Heroes/Lady Mara.md')).not.toContain('hexly.sourcePath');
    expect(text(files, 'Characters/Heroes/Lady Mara.md')).not.toContain('hexly.');
  });

  it('re-emits non-reserved Metadata and Tags as YAML frontmatter', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const worldId = await importVault(ada, {
      'Characters/Lady Mara.md': [
        '---',
        'tags: [Deity, ruined]',
        'aliases: [Mara, The Ranger]',
        'status: alive',
        '---',
        '# Lady Mara',
      ].join('\n'),
    });

    const { files } = await exportZip(ada, worldId);
    const fm = frontmatter(text(files, 'Characters/Lady Mara.md'));

    // Pass-through Metadata round-trips; Tags come back as frontmatter `tags` (ADR-0033).
    expect(fm.status).toBe('alive');
    expect(fm.aliases).toEqual(['Mara', 'The Ranger']);
    expect(fm.tags).toEqual(['deity', 'ruined']);
    // The reserved placement key is still consumed, not written back.
    expect(fm['hexly.sourcePath']).toBeUndefined();
    // An imported note carries the default type alone, which the import mints anyway — so it goes
    // unstamped, and a note with no Metadata and no Tags still exports with no `---` block at all.
    expect(fm['hexly.type']).toBeUndefined();
  });

  /**
   * The Type stamp is generic (ADR-0050): the export names no type id, it writes the Entity's whole
   * ordered set — so a Monster comes back a Monster, and the *primary* type is still the first one.
   */
  it("stamps hexly.type from the Entity's ordered types, whatever they are", async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const worldId = await importVault(ada, { 'Bestiary/Owlbear.md': '# Owlbear' });
    const created = await ada
      .post('/entities')
      .send({ name: 'Owlbear', types: ['core.note', 'dnd.monster'], worldId })
      .expect(201);
    expect(created.body.types).toEqual(['core.note', 'dnd.monster']);

    const { files } = await exportZip(ada, worldId);
    const fm = frontmatter(text(files, 'Owlbear.md'));

    expect(fm['hexly.type']).toEqual(['core.note', 'dnd.monster']);
  });

  it('writes assets under assets/<originalFilename> and rewrites image src to match', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const worldId = await importVault(ada, {
      'attachments/portrait.png': png,
      'Hero.md': 'Hero\n\n![[portrait.png]]',
    });

    const { files } = await exportZip(ada, worldId);

    // Asset written under assets/ with its human-readable original name (not the content hash).
    expect(files).toHaveProperty('assets/portrait.png');
    expect(files['assets/portrait.png']).toEqual(png);
    // The note points at the exported asset, no longer the capability URL.
    const hero = text(files, 'Hero.md');
    expect(hero).toContain('assets/portrait.png');
    expect(hero).not.toContain(`/assets/${worldId}`);
  });

  it("exports a hexmap's lore as markdown and its grid as nested frontmatter (ADR-0050)", async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const worldId = await importVault(ada, { 'Note.md': '# Note' });

    // Arrange a hexmap with lore Content AND a painted, named hex.
    const entities = app.get(EntitiesService);
    const created = entities.create(adaId, {
      types: ['core.hexmap'],
      name: 'Aldermoor Map',
      worldId,
      tags: [],
    });
    entities.save(adaId, created.id, {
      version: created.version,
      tags: [],
      descriptors: [],
      document: {
        content: tiptapContent({
          type: 'doc',
          content: [
            {
              type: 'heading',
              attrs: { level: 1 },
              content: [{ type: 'text', text: 'The Aldermoor' }],
            },
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'A wild frontier.' }],
            },
          ],
        }),
        metadata: { grid: { hexes: { '0,0': { terrain: 'forest', name: 'Rivertown' } }, regions: [], labels: [] } },
      },
    });

    const { files } = await exportZip(ada, worldId);
    const md = text(files, 'Aldermoor Map.md');
    const fm = frontmatter(md);

    // Lore round-trips as prose, and the map's type is flagged — no Metadata key records it.
    expect(fm['hexly.type']).toEqual(['core.hexmap']);
    expect(md).toContain('The Aldermoor');
    expect(md).toContain('A wild frontier.');
    // The grid rides the frontmatter as a nested Field value, so the map survives the round-trip
    // (ADR-0050 amends ADR-0033's lossy export) — and it does so through the generic Metadata path,
    // which knows nothing of hexes.
    expect(fm['grid']).toEqual({
      hexes: { '0,0': { terrain: 'forest', name: 'Rivertown' } },
      regions: [],
      labels: [],
    });
  });

  it('round-trips a fixture vault: import → export reproduces the folder layout and content', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 8, 7, 6]);
    const worldId = await importVault(ada, {
      'attachments/portrait.png': png,
      'Characters/Lady Mara.md': [
        '---',
        'tags: [deity]',
        'status: alive',
        '---',
        '# Lady Mara',
        '',
        '![[portrait.png]]',
      ].join('\n'),
      'Places/Keep.md': 'Held by [[Lady Mara]].',
    });

    const { res, files } = await exportZip(ada, worldId);

    // Exact zip layout: notes under their original folders, assets/ folder — no Home note (ADR-0043).
    expect(Object.keys(files).sort()).toEqual(['Characters/Lady Mara.md', 'Places/Keep.md', 'assets/portrait.png']);

    // Assets kept byte-for-byte under their human-readable name.
    expect(files['assets/portrait.png']).toEqual(png);

    // Metadata + tags round-trip; the image src points back at the exported asset.
    const mara = text(files, 'Characters/Lady Mara.md');
    expect(frontmatter(mara)).toMatchObject({
      tags: ['deity'],
      status: 'alive',
    });
    expect(mara).toContain('assets/portrait.png');
    // The resolved entityLink re-emits as an Obsidian wikilink.
    expect(text(files, 'Places/Keep.md')).toContain('[[Lady Mara]]');

    // Re-importing the export reconstructs an equivalent World: the same two notes land, and the
    // wikilink resolves again.
    const reimport = await ada
      .post('/worlds/import')
      .attach('file', Buffer.from(res.body), 'Aldermoor.zip')
      .expect(201);
    expect(reimport.body.linksResolved).toBe(1);
    const world = await ada.get(`/worlds/${reimport.body.worldId}`).expect(200);
    expect(world.body.entityCount).toBe(2); // Just the two notes — no seeded Home Entity.
  });

  it('re-emits a wikilink with the target entity’s CURRENT name after a rename', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const worldId = await importVault(ada, {
      'Lady Mara.md': '# Lady Mara',
      'Keep.md': 'Held by [[Lady Mara]].',
    });

    // Rename the link target; the wikilink was authored as [[Lady Mara]].
    const entities = app.get(EntitiesService);
    const mara = entities.listByWorld(adaId, worldId).find((e) => e.name === 'Lady Mara');
    entities.patch(adaId, mara!.id, { name: 'Mara' });

    const { files } = await exportZip(ada, worldId);

    // The target now exports as Mara.md and the link points at Mara — not the stale label.
    expect(files).toHaveProperty('Mara.md');
    expect(text(files, 'Keep.md')).toContain('[[Mara]]');
    expect(text(files, 'Keep.md')).not.toContain('[[Lady Mara]]');
  });

  it('refuses the export route without a session cookie', async () => {
    await request(app.getHttpServer()).get('/worlds/whatever/export').expect(401);
  });

  it('404s an unknown or unreachable World', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    await ada.get('/worlds/does-not-exist/export').expect(404);
  });

  it('excludes another member’s shared entity — the export serializes only what the exporter owns', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const worldId = await importVault(ada, { 'Note.md': '# Note' });

    // Bob is a member of Ada's World and owns a *shared* entity in it. A read-scoped export
    // would sweep it up (Ada can read shared member entities); an owner-scoped one must not.
    const bobId = await app.get(AuthService).seedUser('bob@hexly.test', 'correct horse', 'Bob');
    db.insert(worldMembers).values({ worldId, userId: bobId, role: 'contributor' }).run();
    const entities = app.get(EntitiesService);
    const bobNoteId = 'bob-shared-note';
    entities.importNote(bobId, worldId, bobNoteId, 'Bob Secret', [], emptyEntityBody());
    entities.patch(bobId, bobNoteId, { visibility: 'shared' });

    const { files } = await exportZip(ada, worldId);

    // Ada's owner-only export never contains a note she does not own.
    expect(files).not.toHaveProperty('Bob Secret.md');
  });

  it('403s a member who is not the World Owner', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const worldId = await importVault(ada, { 'Note.md': '# Note' });

    // Bob is a named member of Ada's World (reachable) but not its Owner — export is Owner-only.
    const bobId = await app.get(AuthService).seedUser('bob@hexly.test', 'correct horse', 'Bob');
    db.insert(worldMembers).values({ worldId, userId: bobId, role: 'viewer' }).run();
    const bob = await signIn('bob@hexly.test', 'correct horse');

    await bob.get(`/worlds/${worldId}/export`).expect(403);
  });
});
