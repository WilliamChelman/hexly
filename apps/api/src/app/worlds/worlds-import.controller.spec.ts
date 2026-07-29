import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import sharp from 'sharp';
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
import { EntitiesService } from '../entities/entities.service';
import { ConfigModule } from '../config/config.module';
import { HEXLY_CONFIG, HexlyConfig, loadConfig } from '../config';
import { BUNDLED_PLUGIN_CONFIGS } from '../entities/bundled-plugins';
import { WorldsModule } from './worlds.module';
import { CompendiumWrites } from './compendium-writes';
import { CHUNK_SIZE } from './vault-import.service';

/**
 * POST a vault with its per-run options (ADR-0073) as the multipart body's non-file fields — strings,
 * because that is what a multipart body carries. No options means "upload only the file", the shape the
 * web client still sends.
 */
function importVault(agent: request.Agent, zip: Buffer, options: Record<string, string> = {}) {
  let req = agent.post('/worlds/import');
  for (const [key, value] of Object.entries(options)) req = req.field(key, value);
  return req.attach('file', zip, 'Aldermoor.zip').expect(201);
}

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
    links: entityLinks(detail.body.document['core.field.content'].snapshot),
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
  return imageSrcs(detail.body.document['core.field.content'].snapshot);
}

describe('Vault import endpoint', () => {
  let app: INestApplication;
  let db: Db;
  let assetsDir: string;
  let adaId: string;

  /**
   * Boot an Instance over its own throwaway DB, seeded with Ada. `entities` re-states the Instance
   * Configuration's `entities` block, for the specs that need Inline Creation's knobs pointed somewhere
   * visible (ADR-0073); `importConfig` does the same for the `import` block, so a spec can meet a
   * ceiling without writing the thousands of links the shipped one takes. Absent, the loader's defaults stand.
   */
  async function boot(
    entities?: Partial<HexlyConfig['entities']>,
    importConfig?: Partial<HexlyConfig['import']>,
  ): Promise<void> {
    db = createDb(':memory:'); // Isolated per-test (ADR-0002).
    const builder = Test.createTestingModule({
      imports: [ConfigModule, AuthModule, WorldsModule, EntitiesModule],
    })
      .overrideProvider(DB)
      .useValue(db)
      .overrideProvider(ASSETS_DIR)
      .useValue(assetsDir);
    if (entities || importConfig) {
      const base = loadConfig(':memory:', BUNDLED_PLUGIN_CONFIGS);
      builder.overrideProvider(HEXLY_CONFIG).useValue({
        ...base,
        entities: { ...base.entities, ...entities },
        import: { ...base.import, ...importConfig },
      });
    }
    const moduleRef = await builder.compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    // Listen for real: supertest otherwise churns an ephemeral port per request, and a reused loopback
    // 4-tuple still in TIME_WAIT is RST as `socket hang up`.
    await app.listen(0);

    adaId = await app.get(AuthService).seedUser('ada@hexly.test', 'correct horse', 'Ada', {
      roles: ['create-worlds'],
    });
  }

  beforeEach(async () => {
    assetsDir = mkdtempSync(join(tmpdir(), 'hexly-import-assets-'));
    await boot();
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
    expect(mara.types).toEqual(['core.type.note']);
  });

  it('makes an imported note findable by its RichContent prose with no re-save (ADR-0035)', async () => {
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
    expect(mara.body.document['core.field.content'].format).toBe('tiptap-v3');
    expect(mara.body.document['core.field.content'].snapshot.type).toBe('doc');

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

  it("keeps a foreign note's bare frontmatter keys as plain untyped values, never coerced into a namespaced Field (ADR-0056)", async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    // A stranger's Obsidian note, unstamped: a bare `content` key whose leaf collides with the namespaced
    // `core.field.content` Field, and a bare `element` matched by nothing (ADR-0056's own worry, its lines 5-8).
    const zip = vaultZip({
      'Fireheart.md': [
        '---',
        'element: fire',
        'content: A bare content string, not Hexly prose.',
        '---',
        '# Fireheart',
        '',
        'The mountain burns.',
      ].join('\n'),
    });

    const res = await ada.post('/worlds/import').attach('file', zip, 'Aldermoor.zip').expect(201);
    const { detail } = await entityNamed(ada, res.body.worldId, 'Fireheart');

    // A plain Note — no type was stamped, so nothing typed it.
    expect(detail.types).toEqual(['core.type.note']);
    // Both bare keys land verbatim under their own names — data preserved, lensed by no Field.
    expect(detail.document).toMatchObject({
      element: 'fire',
      content: 'A bare content string, not Hexly prose.',
    });
    // The bare `content` and the namespaced `core.field.content` coexist as two distinct predicates sharing a
    // leaf: the body's prose lives at `core.field.content` while the frontmatter string stays at bare `content`.
    expect(typeof detail.document['content']).toBe('string');
    expect(JSON.stringify(detail.document['core.field.content'].snapshot)).toContain('The mountain burns.');
  });

  /** The read half of the export's generic `hexly.type` stamp (#203, ADR-0050). */
  describe('hexly.type', () => {
    it("applies the stamped types to the imported Entity, in order, and doesn't leave them in EntityDocument", async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const zip = vaultZip({
        'Bestiary/Owlbear.md': [
          '---',
          'hexly.type: [core.type.note, dnd.type.monster]',
          'challenge_rating: 3',
          'size: Large',
          '---',
          '# Owlbear',
        ].join('\n'),
      });

      const res = await ada.post('/worlds/import').attach('file', zip, 'Aldermoor.zip').expect(201);
      const { summary, detail } = await entityNamed(ada, res.body.worldId, 'Owlbear');

      // Primary type first, as stamped.
      expect(summary.types).toEqual(['core.type.note', 'dnd.type.monster']);
      expect(detail.document).toMatchObject({ challenge_rating: 3, size: 'Large' });
      // Reserved provenance: consumed, never stored back as author EntityDocument.
      expect(detail.document).not.toHaveProperty('hexly.type');
    });

    it('applies a type this build has never heard of — nothing is resolved on the import path', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      // `world.type.deity`'s definition lives in the World it was authored in, not in the vault. The id
      // still lands: an unresolvable type degrades to the generic Field view (ADR-0048).
      const zip = vaultZip({
        'Deities/Vela.md': ['---', 'hexly.type: [world.type.deity]', 'domain: dusk', '---', '# Vela'].join('\n'),
      });

      const res = await ada.post('/worlds/import').attach('file', zip, 'Aldermoor.zip').expect(201);
      const { summary, detail } = await entityNamed(ada, res.body.worldId, 'Vela');

      expect(summary.types).toEqual(['world.type.deity']);
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
      expect((await entityNamed(ada, res.body.worldId, 'Junk')).summary.types).toEqual(['core.type.note']);
      expect((await entityNamed(ada, res.body.worldId, 'Bare')).summary.types).toEqual(['core.type.note']);
    });

    it('opens an imported note whose grid: frontmatter is not a valid grid', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      // A stranger's vault uses `grid:` for something else. Field validation is forward-only, so the
      // value is stored as it stands.
      const zip = vaultZip({
        'Chart.md': ['---', 'hexly.type: [core.type.hex-map]', 'grid: hand-drawn, 12 squares', '---', '# Chart'].join(
          '\n',
        ),
      });

      const res = await ada.post('/worlds/import').attach('file', zip, 'Aldermoor.zip').expect(201);
      const { summary, detail } = await entityNamed(ada, res.body.worldId, 'Chart');

      expect(summary.types).toEqual(['core.type.hex-map']);
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
        'hexly.type: [core.type.note, world.type.deity]',
        '---',
        '<!-- hexly:field core.field.content -->',
        'Public lore.',
        '',
        '<!-- hexly:field world.field.secrets -->',
        'Hidden truth.',
      ].join('\n'),
    });

    const res = await ada.post('/worlds/import').attach('file', zip, 'Aldermoor.zip').expect(201);
    const { detail } = await entityNamed(ada, res.body.worldId, 'Vela');

    // Each marked block lands at its own key, converted to prose; the marker comment itself is gone.
    expect(JSON.stringify(detail.document['core.field.content'].snapshot)).toContain('Public lore.');
    expect(JSON.stringify(detail.document['world.field.secrets'].snapshot)).toContain('Hidden truth.');
    expect(JSON.stringify(detail.document)).not.toContain('hexly:field');
  });

  it('lands an unmarked body in the first body Field (a plain Obsidian note just works)', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const zip = vaultZip({ 'Keep.md': '# Keep\n\nThe northern keep guards the pass.' });

    const res = await ada.post('/worlds/import').attach('file', zip, 'Aldermoor.zip').expect(201);
    const { detail } = await entityNamed(ada, res.body.worldId, 'Keep');

    // No markers → the whole body converts into the canonical `content` Field.
    expect(detail.document['core.field.content'].format).toBe('tiptap-v3');
    expect(JSON.stringify(detail.document['core.field.content'].snapshot)).toContain(
      'The northern keep guards the pass.',
    );
  });

  it('reports degraded constructs and zero assets in the summary', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const zip = vaultZip({
      'Keep.md': 'Guarded by [[Lady Mara]] and the [[Watch]].[^1]\n\n[^1]: A footnote.',
    });

    const res = await importVault(ada, zip, { createUnresolved: 'false' });

    // Neither wikilink names an imported note, and the switch is off — no assets either.
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
        decor: false,
        source: { id: keep.id, name: 'Keep', types: ['core.type.note'] },
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

  /**
   * Obsidian's link format is a per-vault setting, so the same note may be named three ways. A form the
   * index cannot answer is no longer inert now that a miss mints (ADR-0073) — it would silently double
   * its target — so each shape has to land on the note that is already in the import.
   */
  describe('link forms other than the exact vault path', () => {
    it('resolves a note-relative [[../folder/Note]] to the note it names, minting nothing', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      // Obsidian's stock "Relative path to file" setting writes every cross-folder link this way.
      const zip = vaultZip({
        'people/Alice.md': 'Rode to [[../places/Rivendell]] and stayed.',
        'places/Rivendell.md': '# Rivendell',
      });

      const res = await importVault(ada, zip);

      expect(res.body).toMatchObject({ linksResolved: 1, linksCreated: 0, linksDangling: 0 });
      const byPath = await pathsToIds(ada, res.body.worldId);
      const alice = await linksOf(ada, res.body.worldId, 'Alice');
      expect(alice.links[0].attrs.entityId).toBe(byPath['places/Rivendell.md']);
    });

    it('resolves a same-folder [[./Note]] to its sibling', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const zip = vaultZip({
        'people/Alice.md': 'Travels with [[./Bob]].',
        'people/Bob.md': '# Bob',
      });

      const res = await importVault(ada, zip);

      expect(res.body).toMatchObject({ linksResolved: 1, linksCreated: 0, linksDangling: 0 });
      const byPath = await pathsToIds(ada, res.body.worldId);
      const alice = await linksOf(ada, res.body.worldId, 'Alice');
      expect(alice.links[0].attrs.entityId).toBe(byPath['people/Bob.md']);
    });

    it('resolves a vault-absolute link inside a wrapper directory no .obsidian marked for stripping', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      // Zipped without its config folder, so `reroot` finds no marker and every path keeps `Aldermoor/`
      // while the links stay vault-relative — the basename fallback is what still finds the note.
      const zip = vaultZip({
        'Aldermoor/Keep.md': 'Rode to [[places/Rivendell]] and stayed.',
        'Aldermoor/places/Rivendell.md': '# Rivendell',
      });

      const res = await importVault(ada, zip);

      expect(res.body).toMatchObject({ linksResolved: 1, linksCreated: 0, linksDangling: 0 });
      const byPath = await pathsToIds(ada, res.body.worldId);
      const keep = await linksOf(ada, res.body.worldId, 'Keep');
      expect(keep.links[0].attrs.entityId).toBe(byPath['Aldermoor/places/Rivendell.md']);
    });
  });

  it('leaves a wikilink to a nonexistent note unresolved with the switch off, resolving only the ones that exist', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const zip = vaultZip({
      'Keep.md': 'Held by [[Lady Mara]] against the [[Shadow King]].',
      'Lady Mara.md': '# Lady Mara',
    });

    const res = await importVault(ada, zip, { createUnresolved: 'false' });

    // One target exists, one does not.
    expect(res.body.linksResolved).toBe(1);
    expect(res.body.linksDangling).toBe(1);

    const mara = await linksOf(ada, res.body.worldId, 'Lady Mara');
    const keep = await linksOf(ada, res.body.worldId, 'Keep');
    expect(keep.links[0].attrs.entityId).toBe(mara.id);
    // The Unresolved Link keeps its intent — an id-less entityLink, not plain text (ADR-0073).
    expect(keep.links[1].attrs.entityId).toBeNull();
    expect(keep.links[1].attrs.label).toBe('Shadow King');
  });

  /**
   * The create-unresolved switch (ADR-0073) — on by default, because an importer arrives with Obsidian's
   * model, where an unresolved wikilink is a visible to-write list rather than inert text. The whole
   * on/off × override/default matrix lives here: it is far cheaper than a browser can carry.
   */
  describe('create-unresolved', () => {
    it('mints an Entity for an unresolved wikilink by default, linked by id and carrying the inline Type', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const zip = vaultZip({ 'Keep.md': 'Held against [[Zorblax]].' });

      const res = await importVault(ada, zip);

      // Created, not dangling — and counted as its own thing, so the author reads what the switch did.
      expect(res.body).toMatchObject({ linksResolved: 0, linksCreated: 1, linksDangling: 0 });

      const { summary } = await entityNamed(ada, res.body.worldId, 'Zorblax');
      // `entities.inlineType` defaults to core.type.note; no Tag, because `inlineTag` is unset by default.
      expect(summary?.types).toEqual(['core.type.note']);
      expect(summary?.tags).toEqual([]);

      const keep = await linksOf(ada, res.body.worldId, 'Keep');
      expect(keep.links[0].attrs.entityId).toBe(summary?.id);

      // An ordinary Entity: the edge index records the link with no re-save (ADR-0046).
      const { referencedBy } = (await ada.get(`/entities/${summary?.id}/references`).expect(200)).body;
      expect(referencedBy).toHaveLength(1);
    });

    it('creates nothing with the switch off, leaving an Unresolved Link — today’s behaviour', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const zip = vaultZip({ 'Keep.md': 'Held against [[Zorblax]].' });

      const res = await importVault(ada, zip, { createUnresolved: 'false' });

      expect(res.body).toMatchObject({ linksResolved: 0, linksCreated: 0, linksDangling: 1 });
      const list = await ada.get(`/entities?worldId=${res.body.worldId}`).expect(200);
      expect(list.body.items.map((e: { name: string }) => e.name)).toEqual(['Keep']);
    });

    /**
     * The fourth link-target surface (#400, ADR-0079), pinned rather than fixed: wikilink resolution
     * reads only the vault being imported and mints into the World the run creates, so it cannot reach a
     * Compendium and needs no exclusion rule to keep in step with the other three. This holds that true
     * against the day the resolution learns to consult the database.
     */
    it('never resolves a wikilink to a Compendium Entry, minting the author’s own instead', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const containerId = app.get(CompendiumWrites).install('test.importer.bestiary', { name: 'Bestiary' }, 'rev-1');
      const packGoblin = randomUUID();
      app.get(EntitiesService).importEntity({
        ownerId: adaId,
        containerId,
        id: packGoblin,
        name: 'Goblin',
        types: ['core.type.note'],
        tags: [],
        document: {},
      });

      const res = await importVault(ada, vaultZip({ 'Keep.md': 'Held against [[Goblin]].' }));

      // Minted, not resolved: the link points at the author's own new Entity, in the new World.
      expect(res.body).toMatchObject({ linksResolved: 0, linksCreated: 1, linksDangling: 0 });
      const keep = await linksOf(ada, res.body.worldId, 'Keep');
      expect(keep.links[0].attrs.entityId).not.toBe(packGoblin);
      const { summary } = await entityNamed(ada, res.body.worldId, 'Goblin');
      expect(keep.links[0].attrs.entityId).toBe(summary?.id);
    });

    it('converges two notes naming the same thing on one Entity, answering the second from the index', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const zip = vaultZip({
        'Keep.md': 'Held against [[Zorblax]].',
        'Watch.md': 'Also wary of [[Zorblax]].',
      });

      const res = await importVault(ada, zip);

      // One Entity minted; the second link is answered from the index, so it tallies as resolved.
      expect(res.body).toMatchObject({ linksResolved: 1, linksCreated: 1, linksDangling: 0 });

      const { summary } = await entityNamed(ada, res.body.worldId, 'Zorblax');
      const keep = await linksOf(ada, res.body.worldId, 'Keep');
      const watch = await linksOf(ada, res.body.worldId, 'Watch');
      expect(keep.links[0].attrs.entityId).toBe(summary?.id);
      expect(watch.links[0].attrs.entityId).toBe(summary?.id);
    });

    it('converges [[Zorblax]] and [[zorblax]] on one Entity — ADR-0033’s case-insensitive matching, intact', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const zip = vaultZip({ 'Keep.md': 'Held against [[Zorblax]], feared as [[zorblax]].' });

      const res = await importVault(ada, zip);

      expect(res.body).toMatchObject({ linksResolved: 1, linksCreated: 1, linksDangling: 0 });
      const keep = await linksOf(ada, res.body.worldId, 'Keep');
      expect(keep.links[0].attrs.entityId).toBe(keep.links[1].attrs.entityId);
    });

    it('names a created Entity after the basename, and converges the bare form on it', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      // A mint has no vault path, so its only identity is its name: the bare form finds the one the
      // path-qualified form minted (ADR-0073).
      const zip = vaultZip({ 'Keep.md': 'Held against [[folder/Zorblax]], feared as [[Zorblax]].' });

      const res = await importVault(ada, zip);

      expect(res.body).toMatchObject({ linksResolved: 1, linksCreated: 1, linksDangling: 0 });
      const { summary } = await entityNamed(ada, res.body.worldId, 'Zorblax');
      const keep = await linksOf(ada, res.body.worldId, 'Keep');
      expect(keep.links[0].attrs.entityId).toBe(summary?.id);
      expect(keep.links[1].attrs.entityId).toBe(summary?.id);
    });

    it('mints a created Entity with its Type’s Field defaults, like every other mint', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const zip = vaultZip({ 'Keep.md': 'Held against [[Zorblax]].' });

      const res = await importVault(ada, zip, { inlineType: 'core.type.hex-map' });

      // Without the defaults a Hex Map would open on a blank frame rather than a plane (ADR-0050).
      const { detail } = await entityNamed(ada, res.body.worldId, 'Zorblax');
      expect(detail.document['core.field.grid']).toBeDefined();
    });

    it('folds the Tag through the Tag vocabulary, so it meets an author’s own spelling', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const zip = vaultZip({ 'Keep.md': 'Held against [[Zorblax]].' });

      const res = await importVault(ada, zip, { inlineTag: ' Untriaged ' });

      // Facet values are case-folded, so an unfolded `Untriaged` would sit beside `untriaged` forever.
      expect((await entityNamed(ada, res.body.worldId, 'Zorblax')).summary?.tags).toEqual(['untriaged']);
    });

    it('rejects a malformed Type override rather than writing it into types[0]', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const zip = vaultZip({ 'Keep.md': 'Held against [[Zorblax]].' });

      await ada.post('/worlds/import').field('inlineType', 'nonsense').attach('file', zip, 'Aldermoor.zip').expect(400);
    });

    it('rejects a System-managed Type override, and mints no World for the refused run', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const zip = vaultZip({ 'Keep.md': 'Held against [[Zorblax]].' });

      // The asset type is the system's to assign (ADR-0068); the importer's exemption from the write
      // gate covers frontmatter round-tripping an export, not a Type this request picked.
      await ada
        .post('/worlds/import')
        .field('inlineType', 'core.type.asset')
        .attach('file', zip, 'Aldermoor.zip')
        .expect(400);
      expect((await ada.get('/worlds').expect(200)).body).toEqual([]);
    });

    it('rejects an overlong Tag override rather than stamping it onto every Entity the run mints', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const zip = vaultZip({ 'Keep.md': 'Held against [[Zorblax]].' });

      await ada
        .post('/worlds/import')
        .field('inlineTag', 'x'.repeat(256))
        .attach('file', zip, 'Aldermoor.zip')
        .expect(400);
    });

    it('stops minting at the run’s ceiling, tallying the rest as dangling rather than failing the import', async () => {
      // One note's links all mint inside its own transaction, so the ceiling is what keeps a crafted
      // archive of nothing but distinct wikilinks from pinning the process (ADR-0073).
      await app.close();
      await boot(undefined, { maxCreatedEntities: 2 });
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const zip = vaultZip({ 'Keep.md': 'Held against [[Zorblax]], [[Morblax]] and [[Norblax]].' });

      const res = await importVault(ada, zip);

      // The import lands, and the summary says exactly what it did rather than reading as a success.
      expect(res.body).toMatchObject({ linksResolved: 0, linksCreated: 2, linksDangling: 1 });
      const list = await ada.get(`/entities?worldId=${res.body.worldId}`).expect(200);
      expect(list.body.items.map((e: { name: string }) => e.name).sort()).toEqual(['Keep', 'Morblax', 'Zorblax']);
      // The one past the ceiling keeps its intent — an id-less entityLink, as with the switch off.
      const keep = await linksOf(ada, res.body.worldId, 'Keep');
      expect(keep.links[2].attrs).toMatchObject({ entityId: null, label: 'Norblax' });
    });

    it('applies the per-run Type and Tag overrides over the configured defaults, persisting neither', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const zip = vaultZip({ 'Keep.md': 'Held against [[Zorblax]].' });

      const res = await importVault(ada, zip, {
        inlineType: 'core.type.hex-map',
        inlineTag: 'untriaged',
      });

      expect((await entityNamed(ada, res.body.worldId, 'Zorblax')).summary).toMatchObject({
        types: ['core.type.hex-map'],
        tags: ['untriaged'],
      });

      // This run only: the next import, sending nothing, is back on the Instance defaults.
      const next = await importVault(ada, vaultZip({ 'Hall.md': 'Held against [[Zorblax]].' }));
      expect((await entityNamed(ada, next.body.worldId, 'Zorblax')).summary).toMatchObject({
        types: ['core.type.note'],
        tags: [],
      });
    });

    it('lands an untyped .md file on the default Type and a created mention on the inline Type, in one import', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const zip = vaultZip({ 'Keep.md': 'Held against [[Zorblax]].' });

      // Two default Types live at once, and that is the point (ADR-0073): a note the vault held is not
      // a name it only mentioned.
      const res = await importVault(ada, zip, { inlineType: 'core.type.hex-map' });

      expect((await entityNamed(ada, res.body.worldId, 'Keep')).summary?.types).toEqual(['core.type.note']);
      expect((await entityNamed(ada, res.body.worldId, 'Zorblax')).summary?.types).toEqual(['core.type.hex-map']);
    });

    it('treats a blank Type override as an absent one, falling back to the Instance defaults', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const zip = vaultZip({ 'Keep.md': 'Held against [[Zorblax]].' });

      // A control the author never touched (#347) sends an empty string; that must land, not 400. Blank
      // reads as absent for the Type and as *no tag* for the Tag — here the Instance configures neither.
      const res = await importVault(ada, zip, { inlineType: '', inlineTag: '  ' });

      expect((await entityNamed(ada, res.body.worldId, 'Zorblax')).summary).toMatchObject({
        types: ['core.type.note'],
        tags: [],
      });
    });

    it('rejects a switch that is neither on nor off, rather than guessing', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const zip = vaultZip({ 'Keep.md': 'Held against [[Zorblax]].' });

      await ada
        .post('/worlds/import')
        .field('createUnresolved', 'maybe')
        .attach('file', zip, 'Aldermoor.zip')
        .expect(400);
    });

    it('does not let a created Entity shadow a note in a later chunk', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      // `A Note` links a name only `Zorblax.md` holds, and that file sorts after a full chunk of fillers —
      // pass 1 indexes every note before pass 2 runs, so the link resolves rather than minting a twin.
      const files: Record<string, string> = { 'A Note.md': 'Held against [[Zorblax]].' };
      for (let i = 0; i < CHUNK_SIZE; i++) files[`Filler ${String(i).padStart(3, '0')}.md`] = 'Filler.';
      files['Zorblax.md'] = '# Zorblax';

      const res = await importVault(ada, vaultZip(files));

      expect(res.body).toMatchObject({ linksResolved: 1, linksCreated: 0, linksDangling: 0 });
    });

    describe('under an Instance that points the Inline Creation knobs somewhere else', () => {
      beforeEach(async () => {
        // Re-boot rather than reconfigure: `app.close()` takes the DB with it, so the replacement gets
        // its own — the config is read once at boot, as it is on a real Instance (ADR-0036).
        await app.close();
        await boot({ inlineType: 'core.type.hex-map', inlineTag: 'untriaged' });
      });

      it('mints under the configured inline Type and Tag, while an untyped .md file keeps the default Type', async () => {
        const ada = await signIn('ada@hexly.test', 'correct horse');
        const zip = vaultZip({ 'Keep.md': 'Held against [[Zorblax]].' });

        const res = await importVault(ada, zip);

        expect((await entityNamed(ada, res.body.worldId, 'Zorblax')).summary).toMatchObject({
          types: ['core.type.hex-map'],
          tags: ['untriaged'],
        });
        expect((await entityNamed(ada, res.body.worldId, 'Keep')).summary?.types).toEqual(['core.type.note']);
      });

      it('lets a per-run override beat the configured knobs', async () => {
        const ada = await signIn('ada@hexly.test', 'correct horse');
        const zip = vaultZip({ 'Keep.md': 'Held against [[Zorblax]].' });

        const res = await importVault(ada, zip, { inlineType: 'core.type.note', inlineTag: 'this-run' });

        expect((await entityNamed(ada, res.body.worldId, 'Zorblax')).summary).toMatchObject({
          types: ['core.type.note'],
          tags: ['this-run'],
        });
      });

      it('lets a cleared Tag mint untagged — the one override a blank-is-absent reading could not express', async () => {
        const ada = await signIn('ada@hexly.test', 'correct horse');
        const zip = vaultZip({ 'Keep.md': 'Held against [[Zorblax]].' });

        // Sent, and empty: emptying the prefilled control is the instruction *no tag* (ADR-0073), not
        // "no override" — which would hand the run the Instance's `untriaged` right back.
        const res = await importVault(ada, zip, { inlineTag: '' });

        expect((await entityNamed(ada, res.body.worldId, 'Zorblax')).summary).toMatchObject({
          types: ['core.type.hex-map'],
          tags: [],
        });
      });
    });
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

  it('treats a same-note anchor [[#heading]] as neither resolved, created, nor dangling', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const zip = vaultZip({
      'Keep.md': 'Jump to [[#Defenses]] below.',
    });

    const res = await importVault(ada, zip);

    // An in-note anchor names no note, so it is not a lost link — and not a name to mint either.
    expect(res.body).toMatchObject({ linksResolved: 0, linksCreated: 0, linksDangling: 0 });
    const list = await ada.get(`/entities?worldId=${res.body.worldId}`).expect(200);
    expect(list.body.items).toHaveLength(1);
  });

  it('ignores .obsidian config, but mints every binary as an Asset (ADR-0065)', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const zip = vaultZip({
      'Lady Mara.md': '# Lady Mara',
      '.obsidian/app.json': '{ "theme": "dark" }',
      // An attachment no note embeds is still minted, so an imported vault is immediately browsable.
      'attachments/portrait.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    });

    const res = await ada.post('/worlds/import').attach('file', zip, 'Aldermoor.zip').expect(201);

    expect(res.body.notesImported).toBe(1);
    // Every binary in the zip mints an Asset even when no note references it (ADR-0065): the note plus
    // the portrait Asset. `.obsidian` config is never inflated, so it becomes neither note nor Asset.
    expect(res.body.assetsStored).toBe(1);
    const world = await ada.get(`/worlds/${res.body.worldId}`).expect(200);
    expect(world.body.entityCount).toBe(2);
    // The unreferenced Asset is browsable in the picker; `.obsidian` config produced nothing.
    const assets = await ada.get(`/entities?worldId=${res.body.worldId}&type=core.type.asset`).expect(200);
    expect(assets.body.items).toHaveLength(1);
    const list = await ada.get(`/entities?worldId=${res.body.worldId}`).expect(200);
    const names = list.body.items.map((e: { name: string }) => e.name);
    expect(names).not.toContain('app');
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

  it('mints an Asset (stats + thumbnail) for every binary in the zip, even ones no note embeds (ADR-0065)', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    // A real image sharp can parse, so extraction runs and produces stats + a thumbnail.
    const png = await sharp({ create: { width: 12, height: 4, channels: 3, background: { r: 200, g: 24, b: 24 } } })
      .png()
      .toBuffer();
    const zip = vaultZip({
      // No note references either binary — the imported vault must still be immediately browsable.
      'Note.md': '# Just prose, no embeds',
      'attachments/orphan.png': new Uint8Array(png),
      'gallery/other.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9, 9, 9]),
    });

    const res = await ada.post('/worlds/import').attach('file', zip, 'Aldermoor.zip').expect(201);
    const worldId = res.body.worldId;

    // Both unreferenced binaries minted; the picker offers them as Assets. Assets are hidden from the
    // default listing (ADR-0065/#278), so the picker's own type pin is what selects them into view.
    expect(res.body.assetsStored).toBe(2);
    const assets = (await ada.get('/entities').query({ worldId, type: 'core.type.asset', thumbnails: '1' }).expect(200))
      .body.items as { name: string; id: string; thumbnailUrl: string }[];
    expect(assets.map((a) => a.name).sort()).toEqual(['orphan', 'other']);

    // The parseable PNG carries populated stats and serves a thumbnail — extraction ran inline at mint.
    const orphanRow = assets.find((a) => a.name === 'orphan')!;
    const orphan = await ada.get(`/entities/${orphanRow.id}`).expect(200);
    expect(orphan.body.document['core.field.asset'].stats).not.toBeNull();
    await request(app.getHttpServer()).get(orphanRow.thumbnailUrl).expect(200);
  });

  it('dedups identical binaries in the zip to one Asset — the path-sorted first name wins (ADR-0065)', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const zip = vaultZip({
      'Note.md': '# Note',
      // Byte-identical copies under two paths collapse to a single Asset (one hash, one Entity).
      'b-folder/twin.png': png,
      'a-folder/original.png': png,
    });

    const res = await ada.post('/worlds/import').attach('file', zip, 'Aldermoor.zip').expect(201);

    expect(res.body.assetsStored).toBe(1);
    const assets = (await ada.get(`/entities?worldId=${res.body.worldId}&type=core.type.asset`).expect(200)).body
      .items as { name: string }[];
    // Path-sorted iteration means `a-folder/original.png` mints first, so its stem is the name that sticks.
    expect(assets).toHaveLength(1);
    expect(assets[0].name).toBe('original');
  });

  /** The Asset `hash`es every Entity in `worldId` references, via the derived edge index. */
  function assetEdgesIn(worldId: string): string[] {
    return db
      .select({ targetId: entityEdges.targetId })
      .from(entityEdges)
      .where(and(eq(entityEdges.containerId, worldId), eq(entityEdges.targetKind, 'asset')))
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
    expect(JSON.stringify(note.body.document['core.field.content'].snapshot)).toContain('The frontier realm.');
    expect(note.body.document).not.toHaveProperty('hexly.isHome');
  });

  it('imports a vault larger than one chunk, resolving wikilinks across the chunk boundary', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    // A chunk is a commit unit, not a resolution scope. Zip entry order is persist order, so Alpha and
    // Omega land in different chunks.
    const fillers = CHUNK_SIZE + 3;
    const files: Record<string, string> = { 'Alpha Note.md': '# Alpha Note\n\n[[Omega Note]]' };
    for (let i = 0; i < fillers; i++) files[`Filler ${String(i).padStart(3, '0')}.md`] = 'Filler.';
    files['Omega Note.md'] = '# Omega Note\n\n[[Alpha Note]]';
    const zip = vaultZip(files);

    const res = await ada.post('/worlds/import').attach('file', zip, 'Aldermoor.zip').expect(201);
    const worldId = res.body.worldId;

    expect(res.body).toMatchObject({
      notesImported: fillers + 2,
      filesSkipped: 0,
      linksResolved: 2,
      linksDangling: 0,
    });
    const world = await ada.get(`/worlds/${worldId}`).expect(200);
    expect(world.body.entityCount).toBe(fillers + 2);

    // A name search, not the plain listing: past ENTITY_LIST_MAX_LIMIT one page can't hold the vault.
    const findByName = async (name: string) => {
      const list = await ada.get('/entities').query({ worldId, q: name }).expect(200);
      const summary = (list.body.items as { id: string; name: string }[]).find((e) => e.name === name);
      expect(summary, `no imported Entity named ${name}`).toBeDefined();
      const detail = await ada.get(`/entities/${summary?.id}`).expect(200);
      return { id: summary?.id, links: entityLinks(detail.body.document['core.field.content'].snapshot) };
    };

    const alpha = await findByName('Alpha Note');
    const omega = await findByName('Omega Note');
    expect(alpha.links[0].attrs['entityId']).toBe(omega.id);
    expect(omega.links[0].attrs['entityId']).toBe(alpha.id);
  });

  it('mints every Asset before the first note chunk, so a note resolves an Asset from a later chunk', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    // The note embeds the last Asset in path-sorted order — a per-chunk URL map leaves its src unrewritten.
    const lastAsset = CHUNK_SIZE + 4;
    const files: Record<string, string | Uint8Array> = {
      'Hero.md': `Hero\n\n![[asset-${String(lastAsset).padStart(3, '0')}.png]]`,
    };
    for (let i = 0; i <= lastAsset; i++) {
      // Distinct bytes per file so none dedups away against another (ADR-0065).
      files[`assets/asset-${String(i).padStart(3, '0')}.png`] = new Uint8Array([
        0x89,
        0x50,
        0x4e,
        0x47,
        i >> 8,
        i & 0xff,
      ]);
    }
    const zip = vaultZip(files);

    const res = await ada.post('/worlds/import').attach('file', zip, 'Aldermoor.zip').expect(201);
    const worldId = res.body.worldId;
    expect(res.body.assetsStored).toBe(lastAsset + 1);

    const images = await imagesOf(ada, worldId, 'Hero');
    expect(images[0]).toMatch(new RegExp(`^/assets/${worldId}/[0-9a-f]{64}\\.png$`));
    const served = await ada.get(images[0]).buffer().expect(200);
    expect(new Uint8Array(served.body)).toEqual(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, lastAsset >> 8, lastAsset & 0xff]),
    );
  });

  it('refuses the import route without a session cookie', async () => {
    await request(app.getHttpServer()).post('/worlds/import').expect(401);
  });
});
