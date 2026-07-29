import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { parse as parseYaml } from 'yaml';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { emptyEntityDocument } from '@hexly/domain';
import { tiptapContent } from '@hexly/plugin-content';
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

/** Fetch a note by name via the API and return its converted-doc nodes of one type, in document order. */
async function nodesOf(
  agent: request.Agent,
  worldId: string,
  name: string,
  type: string,
): Promise<Record<string, unknown>[]> {
  const list = await agent.get(`/entities?worldId=${worldId}`).expect(200);
  const summary = list.body.items.find((e: { name: string }) => e.name === name);
  const detail = await agent.get(`/entities/${summary.id}`).expect(200);
  const found: Record<string, unknown>[] = [];
  const walk = (node: { type?: string; content?: unknown[]; attrs?: Record<string, unknown> }) => {
    if (node.type === type) found.push(node.attrs ?? {});
    for (const child of node.content ?? []) walk(child as typeof node);
  };
  walk(detail.body.document['core.field.content'].snapshot);
  return found;
}

/** A note's image `src`s, in document order. */
async function imagesOf(agent: request.Agent, worldId: string, name: string): Promise<string[]> {
  return (await nodesOf(agent, worldId, name, 'image')).map((attrs) => String(attrs['src'] ?? ''));
}

/** A note's `entityLink` node attrs, in document order. */
async function linksOf(agent: request.Agent, worldId: string, name: string): Promise<Record<string, unknown>[]> {
  return nodesOf(agent, worldId, name, 'entityLink');
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
    // Listen for real: supertest otherwise churns an ephemeral port per request, and a reused loopback
    // 4-tuple still in TIME_WAIT is RST as `socket hang up`.
    await app.listen(0);

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
    // One body Field → a plain Markdown file, with no field marker comment (ADR-0051).
    expect(text(files, 'Lady Mara.md')).not.toContain('hexly:field');
  });

  it('writes two body Fields with markers in Field order and re-imports each losslessly (ADR-0051)', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const worldId = await importVault(ada, { 'Note.md': '# Note' });
    const entities = app.get(EntitiesService);

    // A World-defined SECOND prose Field beside the canonical `content`, referenced by a World type. The
    // server slugs `world.field.secrets` and pins the document key to it (ADR-0056).
    await ada
      .post(`/worlds/${worldId}/fields`)
      .send({ segment: 'secrets', label: 'Secrets', dataType: { kind: 'core.datatype.rich-content' } })
      .expect(201);
    await ada
      .post(`/worlds/${worldId}/types`)
      .send({ id: 'world.type.deity', label: 'Deity', fieldRefs: ['world.field.secrets'] })
      .expect(201);

    // An Entity carrying both prose Fields — `content` (core.type.note) and `secrets` (world.type.deity).
    const paragraph = (t: string) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
    const vela = entities.create(adaId, {
      types: ['core.type.note', 'world.type.deity'],
      name: 'Vela',
      worldId,
      tags: [],
    });
    entities.save(adaId, vela.id, {
      version: vela.version,
      tags: [],
      descriptors: [],
      document: {
        'core.field.content': tiptapContent({ type: 'doc', content: [paragraph('Public lore.')] }),
        'world.field.secrets': tiptapContent({ type: 'doc', content: [paragraph('Hidden truth.')] }),
      },
    });

    const { res, files } = await exportZip(ada, worldId);
    const md = text(files, 'Vela.md');

    // Both blocks are marked, content before secrets (resolved Field order), each rendering its prose.
    expect(md).toContain('<!-- hexly:field core.field.content -->');
    expect(md.indexOf('<!-- hexly:field core.field.content -->')).toBeLessThan(
      md.indexOf('<!-- hexly:field world.field.secrets -->'),
    );
    expect(md).toContain('Public lore.');
    expect(md).toContain('Hidden truth.');

    // Re-import lands each block back in the Field it came from, even though `world.type.deity` is unknown to
    // the fresh World — the marker key carries it, converted as prose (ADR-0051).
    const reimport = await ada
      .post('/worlds/import')
      .attach('file', Buffer.from(res.body), 'Aldermoor.zip')
      .expect(201);
    const reimported = entities.listByWorld(adaId, reimport.body.worldId).find((e) => e.name === 'Vela');
    expect(JSON.stringify(reimported?.document['core.field.content'])).toContain('Public lore.');
    expect(JSON.stringify(reimported?.document['world.field.secrets'])).toContain('Hidden truth.');
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

  it('re-emits non-reserved EntityDocument and Tags as YAML frontmatter', async () => {
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

    // Pass-through EntityDocument round-trips; Tags come back as frontmatter `tags` (ADR-0033).
    expect(fm.status).toBe('alive');
    expect(fm.aliases).toEqual(['Mara', 'The Ranger']);
    expect(fm.tags).toEqual(['deity', 'ruined']);
    // The reserved placement key is still consumed, not written back.
    expect(fm['hexly.sourcePath']).toBeUndefined();
    // An imported note carries the default type alone, which the import mints anyway — so it goes
    // unstamped, and a note with no EntityDocument and no Tags still exports with no `---` block at all.
    expect(fm['hexly.type']).toBeUndefined();
  });

  it("stamps hexly.type from the Entity's ordered types, whatever they are", async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const worldId = await importVault(ada, { 'Bestiary/Owlbear.md': '# Owlbear' });
    const created = await ada
      .post('/entities')
      .send({ name: 'Owlbear', types: ['core.type.note', 'dnd.type.monster'], worldId })
      .expect(201);
    expect(created.body.types).toEqual(['core.type.note', 'dnd.type.monster']);

    const { files } = await exportZip(ada, worldId);
    const fm = frontmatter(text(files, 'Owlbear.md'));

    expect(fm['hexly.type']).toEqual(['core.type.note', 'dnd.type.monster']);
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
      types: ['core.type.hex-map'],
      name: 'Aldermoor Map',
      worldId,
      tags: [],
    });
    entities.save(adaId, created.id, {
      version: created.version,
      tags: [],
      descriptors: [],
      document: {
        'core.field.content': tiptapContent({
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
        'core.field.grid': { hexes: { '0,0': { terrain: 'forest', name: 'Rivertown' } }, regions: [], labels: [] },
      },
    });

    const { files } = await exportZip(ada, worldId);
    const md = text(files, 'Aldermoor Map.md');
    const fm = frontmatter(md);

    // Lore round-trips as prose, and the map's type is flagged — no EntityDocument key records it.
    expect(fm['hexly.type']).toEqual(['core.type.hex-map']);
    expect(md).toContain('The Aldermoor');
    expect(md).toContain('A wild frontier.');
    // The grid rides the frontmatter as a nested Field value, so the map survives the round-trip
    // (ADR-0050 amends ADR-0033's lossy export) — and it does so through the generic EntityDocument path,
    // which knows nothing of hexes.
    expect(fm['core.field.grid']).toEqual({
      hexes: { '0,0': { terrain: 'forest', name: 'Rivertown' } },
      regions: [],
      labels: [],
    });
  });

  it("exports a monster's stat block as one nested frontmatter value, and round-trips it (ADR-0055)", async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const worldId = await importVault(ada, { 'Note.md': '# Note' });

    const entities = app.get(EntitiesService);
    const created = entities.create(adaId, {
      types: ['dnd.type.monster'],
      name: 'Ancient Red Dragon',
      worldId,
      tags: [],
    });
    const statBlock = { size: 'Huge', creature_type: 'dragon', challenge_rating: 24, strength: 30 };
    entities.save(adaId, created.id, {
      version: created.version,
      tags: [],
      descriptors: [],
      // The whole stat block is one grouped value at `stat_block` (ADR-0055), beside the prose.
      document: {
        'core.field.content': tiptapContent({ type: 'doc', content: [] }),
        'dnd.field.stat-block': statBlock,
      },
    });

    const { files } = await exportZip(ada, worldId);
    const fm = frontmatter(text(files, 'Ancient Red Dragon.md'));

    // The stat block projects to frontmatter (`vault: { slot: 'frontmatter' }`) as one nested value the
    // generic EntityDocument path serializes and re-reads — no custom converter, mirroring the grid.
    expect(fm['dnd.field.stat-block']).toEqual(statBlock);
  });

  it("round-trips a Draw Steel Monster's FULL stat block — numeric, traits, and abilities (ADR-0055, #247)", async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const worldId = await importVault(ada, { 'Note.md': '# Note' });

    const entities = app.get(EntitiesService);
    const created = entities.create(adaId, {
      types: ['draw-steel.type.monster'],
      name: 'Bone Colossus',
      worldId,
      tags: [],
    });
    // Every branch in one value — scalars, damage maps, Traits (#245), Abilities (#246): if any needed a
    // bespoke `toMarkdown`, that branch would drop on the round-trip (ADR-0055).
    const statBlock = {
      level: 3,
      role: 'brute',
      organization: 'elite',
      ev: 12,
      keywords: ['undead', 'humanoid'],
      size: '2',
      might: 3,
      agility: 1,
      reason: 0,
      intuition: 1,
      presence: 2,
      stamina: 80,
      stability: 2,
      speed: 5,
      free_strike: 6,
      movement_types: ['climb'],
      with_captain: '+1 damage bonus to strikes',
      immunities: { fire: 5 },
      weaknesses: { cold: 5 },
      traits: [{ name: 'Crafty', effect: 'Ignores difficult terrain.' }],
      abilities: [
        {
          name: 'Cleave',
          type: 'main',
          cost: 'Signature',
          keywords: ['melee', 'weapon'],
          distance: 'Melee 1',
          target: 'One creature',
          powerRoll: { characteristic: 'might', t1: '2 damage', t2: '5 damage', t3: '8 damage; push 1' },
        },
        {
          name: 'Watchful',
          type: 'triggered',
          keywords: [],
          distance: 'Self',
          target: 'Self',
          trigger: 'An enemy moves adjacent',
          effect: 'The creature shifts 1.',
        },
      ],
    };
    entities.save(adaId, created.id, {
      version: created.version,
      tags: [],
      document: {
        'core.field.content': tiptapContent({
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A tower of fused bone.' }] }],
        }),
        'draw-steel.field.stat-block': statBlock,
      },
    });

    const { res, files } = await exportZip(ada, worldId);
    const md = text(files, 'Bone Colossus.md');

    // The whole block rides the frontmatter as one nested value; the prose projects to the body.
    expect(frontmatter(md)['draw-steel.field.stat-block']).toEqual(statBlock);
    expect(md).toContain('A tower of fused bone.');

    // Re-importing the export reconstructs the block byte-for-byte — every branch survives the generic
    // frontmatter path, no bespoke converter required (ADR-0055).
    const reimport = await ada
      .post('/worlds/import')
      .attach('file', Buffer.from(res.body), 'Aldermoor.zip')
      .expect(201);
    const reimported = entities.listByWorld(adaId, reimport.body.worldId).find((e) => e.name === 'Bone Colossus');
    expect(reimported?.types).toEqual(['draw-steel.type.monster']);
    expect(reimported?.document['draw-steel.field.stat-block']).toEqual(statBlock);
    expect(JSON.stringify(reimported?.document['core.field.content'])).toContain('A tower of fused bone.');
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

    // EntityDocument + tags round-trip; the image src points back at the exported asset.
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
    // The two notes plus the portrait, minted as its own Asset Entity (ADR-0065); an import seeds no Home Entity.
    expect(world.body.entityCount).toBe(3);
  });

  it('heals a prose image reference across import → export → re-import by content hash (ADR-0065)', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 4, 3, 2, 1]);
    const worldId = await importVault(ada, {
      'attachments/portrait.png': png,
      'Hero.md': 'Hero\n\n![[portrait.png]]',
    });

    // Export writes the bytes back under the human-readable name and repoints the src at that copy.
    const { res, files } = await exportZip(ada, worldId);
    expect(files['assets/portrait.png']).toEqual(png);
    expect(text(files, 'Hero.md')).toContain('assets/portrait.png');
    expect(text(files, 'Hero.md')).not.toContain(`/assets/${worldId}`); // no capability URL leaks into the export

    // Re-import the export: the Asset re-mints by content hash into the NEW World, so the note's
    // `assets/portrait.png` src heals back to a served capability URL scoped to that World.
    const reimport = await ada
      .post('/worlds/import')
      .attach('file', Buffer.from(res.body), 'Aldermoor.zip')
      .expect(201);
    const reworldId = reimport.body.worldId;
    expect(reworldId).not.toBe(worldId);
    expect(reimport.body.assetsStored).toBe(1);

    const heroImages = await imagesOf(ada, reworldId, 'Hero');
    expect(heroImages).toHaveLength(1);
    // The healed src is a capability URL in the re-imported World — the reference is live again, not dangling.
    expect(heroImages[0]).toMatch(new RegExp(`^/assets/${reworldId}/[0-9a-f]{64}\\.png$`));

    // The bytes serve at the healed URL: same content, same hash across the round trip.
    const served = await request(app.getHttpServer()).get(heroImages[0]).expect(200);
    expect(new Uint8Array(served.body)).toEqual(png);
  });

  it("round-trips an Entity's types and its structured values: a Monster, a Hex Map, a user-defined type", async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const worldId = await importVault(ada, { 'Note.md': '# Note' });
    const entities = app.get(EntitiesService);

    // A World-scoped user-defined type — data, not code, and unknown to this build's plugins.
    await ada
      .post(`/worlds/${worldId}/types`)
      .send({
        id: 'world.type.deity',
        label: 'Deity',
        fields: [{ key: 'domain', label: 'Domain', dataType: { kind: 'string' }, required: false, facetable: true }],
      })
      .expect(201);

    // A Monster (plugin type, plain Fields).
    const owlbear = entities.create(adaId, {
      types: ['core.type.note', 'dnd.type.monster'],
      name: 'Owlbear',
      worldId,
      tags: [],
    });
    entities.save(adaId, owlbear.id, {
      version: owlbear.version,
      tags: [],
      descriptors: [],
      document: {
        'core.field.content': tiptapContent({ type: 'doc', content: [] }),
        challenge_rating: 3,
        size: 'Large',
      },
    });

    // A Deity (user-defined type, a plain Field).
    const vela = entities.create(adaId, { types: ['world.type.deity'], name: 'Vela', worldId, tags: [] });
    entities.save(adaId, vela.id, {
      version: vela.version,
      tags: [],
      descriptors: [],
      document: { 'core.field.content': tiptapContent({ type: 'doc', content: [] }), domain: 'dusk' },
    });

    // A Hex Map (plugin type, a Structured Data Type) — terrain, a feature, a region, and a label.
    const grid = {
      hexes: {
        '0,0': { terrain: 'forest', name: 'Rivertown', feature: { ref: 'settlement' } },
        '1,0': { terrain: 'mountain' },
      },
      regions: [{ id: 'r1', name: 'The Whisperwood', color: '#33aa55', hexes: { '0,0': true } }],
      labels: [{ id: 'l1', text: 'The Aldermoor', position: { x: 10, y: 20 }, size: 32 }],
    };
    const map = entities.create(adaId, { types: ['core.type.hex-map'], name: 'Aldermoor Map', worldId, tags: [] });
    entities.save(adaId, map.id, {
      version: map.version,
      tags: [],
      descriptors: [],
      document: { 'core.field.content': tiptapContent({ type: 'doc', content: [] }), grid },
    });

    // Export the World, then import the export back as a fresh World.
    const { res } = await exportZip(ada, worldId);
    const reimport = await ada
      .post('/worlds/import')
      .attach('file', Buffer.from(res.body), 'Aldermoor.zip')
      .expect(201);
    const reimported = entities.listByWorld(adaId, reimport.body.worldId);
    const byName = (name: string) => reimported.find((e) => e.name === name);

    // Primary type first, Fields intact.
    expect(byName('Owlbear')?.types).toEqual(['core.type.note', 'dnd.type.monster']);
    expect(byName('Owlbear')?.document).toMatchObject({ challenge_rating: 3, size: 'Large' });

    // The user-defined type on the same footing — neither was resolved.
    expect(byName('Vela')?.types).toEqual(['world.type.deity']);
    expect(byName('Vela')?.document).toMatchObject({ domain: 'dusk' });

    // Terrain, feature, region, and label all survive.
    expect(byName('Aldermoor Map')?.types).toEqual(['core.type.hex-map']);
    expect(byName('Aldermoor Map')?.document['grid']).toEqual(grid);
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

  describe('a World that draws on a Mount (ADR-0080, #415)', () => {
    const DRAGON = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 5, 5, 5, 5]);

    /**
     * Ada's campaign, the Shelf it Mounts, and one note in the campaign that draws on both halves of what
     * a Mount lends: the shelf's image (bytes) and a link to the shelf's Entity (a reference).
     */
    async function mountedSetup(agent: request.Agent) {
      const shelfId = await importVault(
        agent,
        { 'attachments/dragon.png': DRAGON, 'Green Dragon.md': 'A wyrm.\n\n![[dragon.png]]' },
        'Shelf.zip',
      );
      const worldId = await importVault(agent, { 'Note.md': '# Note' });
      await agent.post(`/worlds/${worldId}/mounts`).send({ containerId: shelfId }).expect(200);

      // The shelf's own capability URL and Entity id — what the campaign's note will point at.
      const shelfImage = (await imagesOf(agent, shelfId, 'Green Dragon'))[0];
      const shelfList = await agent.get(`/entities?worldId=${shelfId}`).expect(200);
      const dragonId = shelfList.body.items.find((e: { name: string }) => e.name === 'Green Dragon').id;

      const entities = app.get(EntitiesService);
      const lair = entities.create(adaId, { types: ['core.type.note'], name: 'The Lair', worldId, tags: [] });
      entities.save(adaId, lair.id, {
        version: lair.version,
        tags: [],
        descriptors: [],
        document: {
          'core.field.content': tiptapContent({
            type: 'doc',
            content: [
              { type: 'image', attrs: { src: shelfImage, alt: null, title: null } },
              {
                type: 'paragraph',
                content: [{ type: 'entityLink', attrs: { entityId: dragonId, label: 'Green Dragon', display: null } }],
              },
            ],
          }),
        },
      });
      return { shelfId, worldId };
    }

    it("writes the Mounted Container's image bytes into the archive and repoints the note at them", async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const { worldId, shelfId } = await mountedSetup(ada);

      const { files } = await exportZip(ada, worldId);

      // The foreign bytes are flattened in beside the World's own, under the same human-readable name.
      expect(files['assets/dragon.png']).toEqual(DRAGON);
      const lair = text(files, 'The Lair.md');
      expect(lair).toContain('assets/dragon.png');
      // No capability URL survives — the archive fetches nothing from the Container it drew on.
      expect(lair).not.toContain(`/assets/${shelfId}`);
      // The Entity Link is NOT flattened: it degrades to the wikilink its label names (ADR-0073).
      expect(lair).toContain('[[Green Dragon]]');
    });

    it('reimports rendering the image from the new World, with no fetch to the Container it came from', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const { worldId, shelfId } = await mountedSetup(ada);
      const { res } = await exportZip(ada, worldId);

      const reimport = await ada
        .post('/worlds/import')
        .attach('file', Buffer.from(res.body), 'Aldermoor.zip')
        .expect(201);
      const reworldId = reimport.body.worldId;

      const images = await imagesOf(ada, reworldId, 'The Lair');
      expect(images).toHaveLength(1);
      // Scoped to the re-imported World: a copy where there was a reference, and nothing points at the shelf.
      expect(images[0]).toMatch(new RegExp(`^/assets/${reworldId}/[0-9a-f]{64}\\.png$`));
      expect(images[0]).not.toContain(shelfId);
      const served = await request(app.getHttpServer()).get(images[0]).expect(200);
      expect(new Uint8Array(served.body)).toEqual(DRAGON);
    });

    it('reimports a link to a Mounted Entity as an Unresolved Link carrying its label (ADR-0073)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const { worldId } = await mountedSetup(ada);
      const { res } = await exportZip(ada, worldId);

      // Auto-creation off, which is the state in which an unmatched wikilink stays an Unresolved Link;
      // with it on the same wikilink mints the note instead (ADR-0073).
      const reimport = await ada
        .post('/worlds/import')
        .field('createUnresolved', 'false')
        .attach('file', Buffer.from(res.body), 'Aldermoor.zip')
        .expect(201);
      expect(reimport.body.linksDangling).toBe(1);

      const links = await linksOf(ada, reimport.body.worldId, 'The Lair');
      // No id and the label intact — exactly what the editor's promote-in-place affordance keys on.
      expect(links).toEqual([expect.objectContaining({ entityId: null, label: 'Green Dragon' })]);
    });

    it('mints the named Entity on reimport when auto-creation is on, promoting the stub in one act', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const { worldId } = await mountedSetup(ada);
      const { res } = await exportZip(ada, worldId);

      const reimport = await ada
        .post('/worlds/import')
        .attach('file', Buffer.from(res.body), 'Aldermoor.zip')
        .expect(201);
      expect(reimport.body.linksCreated).toBe(1);

      const links = await linksOf(ada, reimport.body.worldId, 'The Lair');
      expect(links[0]['label']).toBe('Green Dragon');
      // A real Entity in the re-imported World — the copy, not the shelf's original.
      const minted = app
        .get(EntitiesService)
        .listByWorld(adaId, reimport.body.worldId)
        .find((e) => e.name === 'Green Dragon');
      expect(links[0]['entityId']).toBe(minted?.id);
    });

    it('leaves a World that draws on nothing untouched — the same archive before and after a Mount', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7, 7]);
      const worldId = await importVault(ada, {
        'attachments/portrait.png': png,
        'Hero.md': 'Hero\n\n![[portrait.png]]',
        'Keep.md': 'Held by [[Hero]].',
      });
      const before = (await exportZip(ada, worldId)).files;

      // Mounting a Container this World points at nothing in changes what it MAY point at, never what it
      // holds — so the archive is entry-for-entry the one it was.
      const shelfId = await importVault(ada, { 'attachments/dragon.png': DRAGON }, 'Shelf.zip');
      await ada.post(`/worlds/${worldId}/mounts`).send({ containerId: shelfId }).expect(200);

      const after = (await exportZip(ada, worldId)).files;
      expect(after).toEqual(before);
      expect(Object.keys(after).sort()).toEqual(['Hero.md', 'Keep.md', 'assets/portrait.png']);
    });

    it('leaves out a foreign image in Missing Bytes rather than failing the export', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const { worldId, shelfId } = await mountedSetup(ada);
      // The shelf's byte folder goes away under the export's feet — an unmounted volume, a relocated root.
      rmSync(join(assetsDir, shelfId), { recursive: true, force: true });

      const { files } = await exportZip(ada, worldId);

      // The export still lands; the picture is simply absent, and the note keeps the src it had.
      expect(files).not.toHaveProperty('assets/dragon.png');
      expect(files).toHaveProperty('The Lair.md');
      expect(text(files, 'The Lair.md')).toContain(`/assets/${shelfId}`);
    });
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
    entities.importEntity({
      ownerId: bobId,
      containerId: worldId,
      id: bobNoteId,
      name: 'Bob Secret',
      types: ['core.type.note'],
      tags: [],
      document: emptyEntityDocument(),
    });
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
