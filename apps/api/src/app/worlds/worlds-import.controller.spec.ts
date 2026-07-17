import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { DB, Db, createDb } from '../db/db';
import { entityEdges } from '../db/schema';
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

/** Collect every `entityLink` node in a converted doc snapshot, in document order. */
function entityLinks(snapshot: { content?: unknown[]; type?: string }): { attrs: Record<string, unknown> }[] {
  const found: { attrs: Record<string, unknown> }[] = [];
  const walk = (node: { type?: string; content?: unknown[]; attrs?: Record<string, unknown> }) => {
    if (node.type === 'entityLink') found.push({ attrs: node.attrs ?? {} });
    for (const child of node.content ?? []) walk(child as typeof node);
  };
  walk(snapshot);
  return found;
}

/** Fetch a note by name and return its entityLink nodes. */
async function linksOf(agent: request.Agent, worldId: string, name: string) {
  const list = await agent.get(`/entities?worldId=${worldId}`).expect(200);
  const summary = list.body.items.find((e: { name: string }) => e.name === name);
  const detail = await agent.get(`/entities/${summary.id}`).expect(200);
  return {
    id: summary.id,
    links: entityLinks(detail.body.document['core.content'].snapshot),
  };
}

/** Map every imported note's `hexly.sourcePath` to its entity id (for notes that share a name). */
async function pathsToIds(agent: request.Agent, worldId: string): Promise<Record<string, string>> {
  const list = await agent.get(`/entities?worldId=${worldId}`).expect(200);
  const out: Record<string, string> = {};
  for (const item of list.body.items as { id: string }[]) {
    const detail = await agent.get(`/entities/${item.id}`).expect(200);
    const path = detail.body.document?.['hexly.sourcePath'];
    if (path) out[path] = item.id;
  }
  return out;
}

/** Fetch one imported Entity by name: its list summary (types, tags) and its full detail. */
async function entityNamed(agent: request.Agent, worldId: string, name: string) {
  const list = await agent.get(`/entities?worldId=${worldId}`).expect(200);
  const items = list.body.items as { id: string; name: string }[];
  const summary = items.find((e) => e.name === name);
  // A miss means the file never imported — say so, rather than dereferencing undefined.
  expect(summary, `no imported Entity named ${name}`).toBeDefined();
  const detail = await agent.get(`/entities/${summary?.id}`).expect(200);
  return { summary, detail: detail.body };
}

/** Collect every `image` node's `src` in a converted doc snapshot, in document order. */
function imageSrcs(snapshot: { content?: unknown[]; type?: string }): string[] {
  const found: string[] = [];
  const walk = (node: { type?: string; content?: unknown[]; attrs?: Record<string, unknown> }) => {
    if (node.type === 'image') found.push(String(node.attrs?.['src'] ?? ''));
    for (const child of node.content ?? []) walk(child as typeof node);
  };
  walk(snapshot);
  return found;
}

/** Fetch a note by name and return its image `src`s. */
async function imagesOf(agent: request.Agent, worldId: string, name: string): Promise<string[]> {
  const list = await agent.get(`/entities?worldId=${worldId}`).expect(200);
  const summary = list.body.items.find((e: { name: string }) => e.name === name);
  const detail = await agent.get(`/entities/${summary.id}`).expect(200);
  return imageSrcs(detail.body.document['core.content'].snapshot);
}

describe('Vault import endpoint', () => {
  let app: INestApplication;
  let db: Db;
  let assetsDir: string;

  beforeEach(async () => {
    db = createDb(':memory:'); // Isolated per-test (ADR-0002).
    assetsDir = mkdtempSync(join(tmpdir(), 'hexly-import-assets-'));
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

    await app.get(AuthService).seedUser('ada@hexly.test', 'correct horse', 'Ada', {
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

  it('forbids importing a vault without the World Creation capability (ADR-0040)', async () => {
    // Import mints a World too, so it is gated identically to POST /worlds.
    await app.get(AuthService).seedUser('bob@hexly.test', 'hunter2 stationery', 'Bob', {
      roles: [],
    });
    const bob = await signIn('bob@hexly.test', 'hunter2 stationery');
    const zip = vaultZip({ 'Note.md': '# Note' });

    await bob.post('/worlds/import').attach('file', zip, 'Aldermoor.zip').expect(403);
  });

  it('imports a vault .zip into a new World named after the file, one note per markdown file', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const zip = vaultZip({
      'Lady Mara.md': '# Lady Mara\n\nA ranger of the north.',
    });

    const res = await ada.post('/worlds/import').attach('file', zip, 'Aldermoor.zip').expect(201);

    expect(res.body).toMatchObject({
      worldId: expect.any(String),
      notesImported: 1,
      filesSkipped: 0,
    });

    // World is named after the uploaded file (sans .zip).
    const world = await ada.get(`/worlds/${res.body.worldId}`).expect(200);
    expect(world.body.name).toBe('Aldermoor');

    // The markdown file became a `note` named after its filename (Home + note = 2).
    const list = await ada.get(`/entities?worldId=${res.body.worldId}`).expect(200);
    const mara = list.body.items.find((e: { name: string }) => e.name === 'Lady Mara');
    expect(mara).toBeDefined();
    expect(mara.types).toEqual(['core.note']);
  });

  it('makes an imported note findable by its Content prose with no re-save (ADR-0035)', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const zip = vaultZip({
      'Lady Mara.md': '# Lady Mara\n\nA ranger of the sunken citadel.',
    });

    const res = await ada.post('/worlds/import').attach('file', zip, 'Aldermoor.zip').expect(201);

    // The import path (not a save) populated content_text, so the extractor ran
    // and the FTS INSERT trigger indexed it — searchable straight out of import.
    const found = await ada.get('/entities').query({ q: 'citadel', worldId: res.body.worldId }).expect(200);
    expect(found.body.items.map((e: { name: string }) => e.name)).toEqual(['Lady Mara']);
  });

  it('preserves the folder path as hexly.sourcePath, frontmatter as EntityDocument, and tags as Hexly Tags', async () => {
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

    const res = await ada.post('/worlds/import').attach('file', zip, 'Aldermoor.zip').expect(201);

    const list = await ada.get(`/entities?worldId=${res.body.worldId}`).expect(200);
    const summary = list.body.items.find((e: { name: string }) => e.name === 'Lady Mara');

    // Frontmatter tags become Hexly Tags, normalized (lower-cased, deduped).
    expect(summary.tags).toEqual(['deity', 'ruined']);

    const mara = await ada.get(`/entities/${summary.id}`).expect(200);
    // Body converted to the opaque tiptap-v3 snapshot (ADR-0019).
    expect(mara.body.document['core.content'].format).toBe('tiptap-v3');
    expect(mara.body.document['core.content'].snapshot.type).toBe('doc');

    // Folder path preserved under the reserved namespace; frontmatter (incl. aliases)
    // passes through as EntityDocument; `tags` moved out to Hexly Tags (not left in EntityDocument). The body IS
    // the EntityDocument map now (ADR-0051), so the prose sits at `content` beside these keys.
    expect(mara.body.document).toMatchObject({
      'hexly.sourcePath': 'Characters/Lady Mara.md',
      aliases: ['Mara', 'The Ranger'],
      status: 'alive',
    });
    expect(mara.body.document).not.toHaveProperty('tags');
  });

  /** The read half of the export's generic `hexly.type` stamp (#203, ADR-0050). */
  describe('hexly.type', () => {
    it("applies the stamped types to the imported Entity, in order, and doesn't leave them in EntityDocument", async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const zip = vaultZip({
        'Bestiary/Owlbear.md': [
          '---',
          'hexly.type: [core.note, dnd.monster]',
          'challenge_rating: 3',
          'size: Large',
          '---',
          '# Owlbear',
        ].join('\n'),
      });

      const res = await ada.post('/worlds/import').attach('file', zip, 'Aldermoor.zip').expect(201);
      const { summary, detail } = await entityNamed(ada, res.body.worldId, 'Owlbear');

      // Primary type first, as stamped.
      expect(summary.types).toEqual(['core.note', 'dnd.monster']);
      expect(detail.document).toMatchObject({ challenge_rating: 3, size: 'Large' });
      // Reserved provenance: consumed, never stored back as author EntityDocument.
      expect(detail.document).not.toHaveProperty('hexly.type');
    });

    it('applies a type this build has never heard of — nothing is resolved on the import path', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      // `world.deity`'s definition lives in the World it was authored in, not in the vault. The id
      // still lands: an unresolvable type degrades to the generic Field view (ADR-0048).
      const zip = vaultZip({
        'Deities/Vela.md': ['---', 'hexly.type: [world.deity]', 'domain: dusk', '---', '# Vela'].join('\n'),
      });

      const res = await ada.post('/worlds/import').attach('file', zip, 'Aldermoor.zip').expect(201);
      const { summary, detail } = await entityNamed(ada, res.body.worldId, 'Vela');

      expect(summary.types).toEqual(['world.deity']);
      expect(detail.document).toMatchObject({ domain: 'dusk' });
    });

    it('falls back to a plain Note when the stamp is malformed — a stranger’s vault never breaks a World', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const zip = vaultZip({
        'Junk.md': ['---', 'hexly.type: 42', '---', '# Junk'].join('\n'),
        'Bare.md': ['---', 'hexly.type: [nodots]', '---', '# Bare'].join('\n'),
      });

      const res = await ada.post('/worlds/import').attach('file', zip, 'Aldermoor.zip').expect(201);

      // Neither file is skipped.
      expect(res.body.notesImported).toBe(2);
      expect((await entityNamed(ada, res.body.worldId, 'Junk')).summary.types).toEqual(['core.note']);
      expect((await entityNamed(ada, res.body.worldId, 'Bare')).summary.types).toEqual(['core.note']);
    });

    it('opens an imported note whose grid: frontmatter is not a valid grid', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      // A stranger's vault uses `grid:` for something else. Field validation is forward-only, so the
      // value is stored as it stands.
      const zip = vaultZip({
        'Chart.md': ['---', 'hexly.type: [core.hexmap]', 'grid: hand-drawn, 12 squares', '---', '# Chart'].join('\n'),
      });

      const res = await ada.post('/worlds/import').attach('file', zip, 'Aldermoor.zip').expect(201);
      const { summary, detail } = await entityNamed(ada, res.body.worldId, 'Chart');

      expect(summary.types).toEqual(['core.hexmap']);
      expect(detail.document).toMatchObject({ grid: 'hand-drawn, 12 squares' });
    });
  });

  it('splits a two-body-Field file on its markers, landing each block in the Field it names (ADR-0051)', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    // A file a Hexly export wrote for an Entity with two prose Fields: markers name each block. The type
    // is unknown to this fresh World, so the marker keys — not a resolved schema — route the blocks.
    const zip = vaultZip({
      'Vela.md': [
        '---',
        'hexly.type: [core.note, world.deity]',
        '---',
        '<!-- hexly:field core.content -->',
        'Public lore.',
        '',
        '<!-- hexly:field secrets -->',
        'Hidden truth.',
      ].join('\n'),
    });

    const res = await ada.post('/worlds/import').attach('file', zip, 'Aldermoor.zip').expect(201);
    const { detail } = await entityNamed(ada, res.body.worldId, 'Vela');

    // Each marked block lands at its own key, converted to prose; the marker comment itself is gone.
    expect(JSON.stringify(detail.document['core.content'].snapshot)).toContain('Public lore.');
    expect(JSON.stringify(detail.document.secrets.snapshot)).toContain('Hidden truth.');
    expect(JSON.stringify(detail.document)).not.toContain('hexly:field');
  });

  it('lands an unmarked body in the first body Field (a plain Obsidian note just works)', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const zip = vaultZip({ 'Keep.md': '# Keep\n\nThe northern keep guards the pass.' });

    const res = await ada.post('/worlds/import').attach('file', zip, 'Aldermoor.zip').expect(201);
    const { detail } = await entityNamed(ada, res.body.worldId, 'Keep');

    // No markers → the whole body converts into the canonical `content` Field.
    expect(detail.document['core.content'].format).toBe('tiptap-v3');
    expect(JSON.stringify(detail.document['core.content'].snapshot)).toContain('The northern keep guards the pass.');
  });

  it('reports dangling links, degraded constructs, and zero assets in the summary', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const zip = vaultZip({
      'Keep.md': 'Guarded by [[Lady Mara]] and the [[Watch]].[^1]\n\n[^1]: A footnote.',
    });

    const res = await ada.post('/worlds/import').attach('file', zip, 'Aldermoor.zip').expect(201);

    // Wikilinks are dangling this slice (resolution is the next one); no assets yet.
    expect(res.body.linksResolved).toBe(0);
    expect(res.body.linksDangling).toBe(2);
    expect(res.body.assetsStored).toBe(0);
    // A construct with no native node (the footnote) is degraded and tallied, not silently lost.
    expect(res.body.constructsDegraded).toEqual({ footnote: 1 });
  });

  it('resolves [[Note]] to an entityLink pointing at the created note', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const zip = vaultZip({
      'Keep.md': 'Guarded by [[Lady Mara]].',
      'Lady Mara.md': '# Lady Mara',
    });

    const res = await ada.post('/worlds/import').attach('file', zip, 'Aldermoor.zip').expect(201);

    expect(res.body.linksResolved).toBe(1);
    expect(res.body.linksDangling).toBe(0);

    const mara = await linksOf(ada, res.body.worldId, 'Lady Mara');
    const keep = await linksOf(ada, res.body.worldId, 'Keep');
    expect(keep.links).toHaveLength(1);
    expect(keep.links[0].attrs.entityId).toBe(mara.id);

    // The import goes through EntityWrites.insert, so the edge index is populated with no
    // re-save (ADR-0046) — the wikilink resolves to an `entityId` *before* the row is written.
    const { referencedBy } = (await ada.get(`/entities/${mara.id}/references`).expect(200)).body;
    expect(referencedBy).toEqual([
      {
        descriptor: null,
        source: { id: keep.id, name: 'Keep', types: ['core.note'] },
      },
    ]);
  });

  it('path-disambiguates [[folder/Note]] and resolves a bare ambiguous basename to a deterministic first match', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    // Two notes share the basename "Guard"; a third links to each — one by path, one bare.
    const zip = vaultZip({
      'North/Guard.md': '# North Guard',
      'South/Guard.md': '# South Guard',
      'Keep.md': 'The [[South/Guard]] and the bare [[Guard]].',
    });

    const res = await ada.post('/worlds/import').attach('file', zip, 'Aldermoor.zip').expect(201);

    expect(res.body.linksResolved).toBe(2);
    expect(res.body.linksDangling).toBe(0);

    // Both Guard notes share a name, so resolve their ids by vault path instead.
    const byPath = await pathsToIds(ada, res.body.worldId);
    const keep = await linksOf(ada, res.body.worldId, 'Keep');

    // Path-qualified link lands on the right note despite the shared basename.
    expect(keep.links[0].attrs.entityId).toBe(byPath['South/Guard.md']);
    // Bare ambiguous basename resolves to the first in path-sorted order (North/ before South/).
    expect(keep.links[1].attrs.entityId).toBe(byPath['North/Guard.md']);
  });

  it('leaves a wikilink to a nonexistent note dangling, resolving only the ones that exist', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const zip = vaultZip({
      'Keep.md': 'Held by [[Lady Mara]] against the [[Shadow King]].',
      'Lady Mara.md': '# Lady Mara',
    });

    const res = await ada.post('/worlds/import').attach('file', zip, 'Aldermoor.zip').expect(201);

    // One target exists, one does not.
    expect(res.body.linksResolved).toBe(1);
    expect(res.body.linksDangling).toBe(1);

    const mara = await linksOf(ada, res.body.worldId, 'Lady Mara');
    const keep = await linksOf(ada, res.body.worldId, 'Keep');
    expect(keep.links[0].attrs.entityId).toBe(mara.id);
    // The unresolved link keeps its intent — a dangling entityLink, not plain text.
    expect(keep.links[1].attrs.entityId).toBeNull();
    expect(keep.links[1].attrs.label).toBe('Shadow King');
  });

  it('resolves display/heading links to entityIds while leaving ![[embed]] a plain, uncounted link', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const zip = vaultZip({
      'Keep.md': 'See [[Lady Mara#Backstory]] and [[Lady Mara|the ranger]]; ![[Lady Mara]] is embedded.',
      'Lady Mara.md': '# Lady Mara',
    });

    const res = await ada.post('/worlds/import').attach('file', zip, 'Aldermoor.zip').expect(201);

    // Two real wikilinks resolve; the embed is a plain link, not an entityLink, so it isn't counted.
    expect(res.body.linksResolved).toBe(2);
    expect(res.body.linksDangling).toBe(0);

    const mara = await linksOf(ada, res.body.worldId, 'Lady Mara');
    const keep = await linksOf(ada, res.body.worldId, 'Keep');
    expect(keep.links).toHaveLength(2);
    // Resolution fills entityId without disturbing the display/heading the converter parsed.
    expect(keep.links[0].attrs).toMatchObject({
      entityId: mara.id,
      heading: 'Backstory',
    });
    expect(keep.links[1].attrs).toMatchObject({
      entityId: mara.id,
      display: 'the ranger',
    });
  });

  it('strips a wrapping vault directory (detected via .obsidian/) so vault-relative links still resolve', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    // A zip made by compressing the vault folder nests everything under `Aldermoor/`; the
    // `.obsidian/` config marks the true vault root, so the wrapper is stripped.
    const zip = vaultZip({
      'Aldermoor/.obsidian/app.json': '{}',
      'Aldermoor/North/Guard.md': '# North Guard',
      'Aldermoor/South/Guard.md': '# South Guard',
      'Aldermoor/Keep.md': 'The [[South/Guard]] holds.',
    });

    const res = await ada.post('/worlds/import').attach('file', zip, 'Aldermoor.zip').expect(201);

    // The vault-relative link resolves despite the wrapper, and sourcePath is stored wrapper-free.
    expect(res.body.linksResolved).toBe(1);
    expect(res.body.linksDangling).toBe(0);

    const byPath = await pathsToIds(ada, res.body.worldId);
    expect(byPath).toHaveProperty('South/Guard.md');
    const keep = await linksOf(ada, res.body.worldId, 'Keep');
    expect(keep.links[0].attrs.entityId).toBe(byPath['South/Guard.md']);
  });

  it('treats a same-note anchor [[#heading]] as neither resolved nor dangling', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const zip = vaultZip({
      'Keep.md': 'Jump to [[#Defenses]] below.',
    });

    const res = await ada.post('/worlds/import').attach('file', zip, 'Aldermoor.zip').expect(201);

    // An in-note anchor names no note, so it is not a lost link.
    expect(res.body.linksResolved).toBe(0);
    expect(res.body.linksDangling).toBe(0);
  });

  it('ignores .obsidian config and non-note files, importing only markdown', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const zip = vaultZip({
      'Lady Mara.md': '# Lady Mara',
      '.obsidian/app.json': '{ "theme": "dark" }',
      'attachments/portrait.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    });

    const res = await ada.post('/worlds/import').attach('file', zip, 'Aldermoor.zip').expect(201);

    expect(res.body.notesImported).toBe(1);
    // The World holds just the one imported note (no seeded Home Entity, ADR-0043).
    const world = await ada.get(`/worlds/${res.body.worldId}`).expect(200);
    expect(world.body.entityCount).toBe(1);
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

    const res = await ada.post('/worlds/import').attach('file', zip, 'Aldermoor.zip').expect(201);

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

    await ada.post('/worlds/import').attach('file', Buffer.from('not a zip at all'), 'Aldermoor.zip').expect(400);

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

  it('stores embedded images content-addressed (deduped), rewrites their src, passes external URLs through, and serves the bytes', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const zip = vaultZip({
      'attachments/portrait.png': png,
      // Two notes embed the SAME image (Obsidian `![[filename]]`, resolved vault-wide by name).
      'Hero.md': 'Hero\n\n![[portrait.png]]',
      // Villain re-embeds the same image and also references an external URL that must pass through.
      'Villain.md': 'Villain\n\n![[portrait.png]]\n\n![logo](https://example.com/logo.png)',
    });

    const res = await ada.post('/worlds/import').attach('file', zip, 'Aldermoor.zip').expect(201);

    // Referenced once effectively, stored once (content-addressed dedup, ADR-0034).
    expect(res.body.assetsStored).toBe(1);
    const worldId = res.body.worldId;

    const heroImages = await imagesOf(ada, worldId, 'Hero');
    const villainImages = await imagesOf(ada, worldId, 'Villain');

    // Both notes point at the same capability URL; external URL is untouched.
    expect(heroImages).toHaveLength(1);
    expect(heroImages[0]).toMatch(new RegExp(`^/assets/${worldId}/[0-9a-f]{64}\\.png$`));
    expect(villainImages).toEqual([heroImages[0], 'https://example.com/logo.png']);

    // The rewritten src resolves: the bytes are served unauthenticated at that URL.
    const anon = request(app.getHttpServer());
    const served = await anon.get(heroImages[0]).expect(200);
    expect(new Uint8Array(served.body)).toEqual(png);

    // `storeImages` must rewrite the src *before* `importNote` inserts the row and harvests edges;
    // after, a vault-relative src names no Asset and the edge is silently lost. An external URL is
    // no Asset, so it is no edge: Villain has one asset edge, not two.
    const hash = heroImages[0].split('/').pop()!.replace('.png', '');
    expect(assetEdgesIn(worldId)).toEqual([hash, hash]);
  });

  /** The Asset `hash`es every Entity in `worldId` references, via the derived edge index. */
  function assetEdgesIn(worldId: string): string[] {
    return db
      .select({ targetId: entityEdges.targetId })
      .from(entityEdges)
      .where(and(eq(entityEdges.worldId, worldId), eq(entityEdges.targetKind, 'asset')))
      .all()
      .map((row) => row.targetId);
  }

  it("removes a World's asset folder when the World is deleted", async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 5, 6, 7, 8]);
    const zip = vaultZip({
      'attachments/portrait.png': png,
      'Hero.md': 'Hero\n\n![[portrait.png]]',
    });

    const worldId = (await ada.post('/worlds/import').attach('file', zip, 'Aldermoor.zip').expect(201)).body.worldId;
    const [assetUrl] = await imagesOf(ada, worldId, 'Hero');
    await request(app.getHttpServer()).get(assetUrl).expect(200); // present before delete
    expect(existsSync(join(assetsDir, worldId))).toBe(true);

    await ada.delete(`/worlds/${worldId}`).expect(204);

    // The World's whole asset folder is gone; the bytes no longer serve.
    expect(existsSync(join(assetsDir, worldId))).toBe(false);
    await request(app.getHttpServer()).get(assetUrl).expect(404);
  });

  it('imports a legacy hexly.isHome note as an ordinary Note (ADR-0043)', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    // A vault an older Hexly exported still flags one note `hexly.isHome`; with the Home Entity
    // gone it imports as a plain note like any other — the reserved flag is just stripped.
    const zip = vaultZip({
      'Aldermoor.md': ['---', 'hexly.isHome: true', '---', '# Aldermoor', '', 'The frontier realm.'].join('\n'),
      'Lady Mara.md': '# Lady Mara',
    });

    const res = await ada.post('/worlds/import').attach('file', zip, 'Aldermoor.zip').expect(201);
    const worldId = res.body.worldId;

    // Both files land as ordinary notes — nothing was routed into or merged with a Home Entity.
    const world = await ada.get(`/worlds/${worldId}`).expect(200);
    expect(world.body.entityCount).toBe(2);

    const list = await ada.get(`/entities?worldId=${worldId}`).expect(200);
    const aldermoor = list.body.items.find((e: { name: string }) => e.name === 'Aldermoor');
    const note = await ada.get(`/entities/${aldermoor.id}`).expect(200);
    // It carries its lore, and the reserved `hexly.*` key isn't persisted as author EntityDocument.
    expect(JSON.stringify(note.body.document['core.content'].snapshot)).toContain('The frontier realm.');
    expect(note.body.document).not.toHaveProperty('hexly.isHome');
  });

  it('refuses the import route without a session cookie', async () => {
    await request(app.getHttpServer()).post('/worlds/import').expect(401);
  });
});
