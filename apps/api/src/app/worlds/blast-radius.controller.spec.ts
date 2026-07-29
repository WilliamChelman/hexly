import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import {
  assetUrl,
  CompendiumPackSummary,
  EntityDocument,
  ImportProduction,
  Importer,
  InboundLinkCount,
} from '@hexly/domain';
import { emptyRichContent, tiptapContent } from '@hexly/plugin-content';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { ConfigModule } from '../config/config.module';
import { DB, Db, createDb } from '../db/db';
import { assetIndex, entities } from '../db/schema';
import { EntitiesModule } from '../entities/entities.module';
import { ImporterRegistry } from './importer-registry';
import { WorldsModule } from './worlds.module';

const PACK_ID = 'test.importer.pack';

/**
 * The blast radius of the three acts that break links (#414, ADR-0080): unmounting a Container,
 * deleting one, and an operator removing a pack. Each states a count before it happens and **none is
 * refused by it** — a destructive act another user's configuration could veto is worse than a dangling
 * link, which is the option ADR-0080 rejects by name.
 *
 * At the HTTP seam throughout, like the Mounts spec beside it: the count is a number a confirm renders,
 * so what matters is the answer a caller actually gets and that the act proceeds regardless.
 */
describe('The blast radius of breaking links', () => {
  let app: INestApplication;
  let db: Db;

  /** Ada owns the campaign that draws on things and the shelf it draws from; Bob owns his own World. */
  let campaign: string;
  let shelf: string;
  let bobWorld: string;

  const pack: Importer = {
    id: PACK_ID,
    label: 'Stub Pack',
    compendium: { name: 'Stub Pack', attribution: { publisher: 'Stub Press' } },
    produce: async () => production,
  };
  let production: ImportProduction;

  beforeEach(async () => {
    db = createDb(':memory:'); // Isolated per-test (ADR-0002).
    production = {
      rev: 'rev-1',
      records: [{ sourceId: 'goblin', name: 'Goblin', types: ['core.type.note'], document: {} }],
    };

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, AuthModule, WorldsModule, EntitiesModule],
    })
      .overrideProvider(DB)
      .useValue(db)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    // Listen for real: supertest otherwise churns an ephemeral port per request.
    await app.listen(0);
    app.get(ImporterRegistry).register(pack);

    await seed('ada@hexly.test', 'Ada');
    await seed('bob@hexly.test', 'Bob');
    await app.get(AuthService).seedUser('ted@hexly.test', 'correct horse', 'Ted', { isSuperadmin: true });

    const ada = await signIn('ada@hexly.test');
    campaign = await mintWorld(ada, 'Aldermoor');
    shelf = await mintWorld(ada, 'The Art Shelf');
    bobWorld = await mintWorld(await signIn('bob@hexly.test'), 'Bob’s Barrow');
  });

  afterEach(async () => {
    await app.close();
  });

  it('states how many links from this World point into a Mount, and unmounts whatever the count', async () => {
    const ada = await signIn('ada@hexly.test');
    const sunset = await mintEntity(ada, shelf, 'Sunset over Aldermoor');
    const oak = await mintEntity(ada, shelf, 'The Hanging Oak');
    const tavern = await mintEntity(ada, campaign, 'The Tavern');
    await mount(ada, campaign, shelf);
    await link(ada, tavern, [
      { entityId: sunset, label: 'Sunset' },
      { entityId: oak, label: 'Oak' },
    ]);

    // Two links, from the one World doing the asking — unmount's question names its own source.
    expect(await mountLinks(ada, campaign, shelf)).toEqual({ links: 2, worlds: 1 });

    // And the number refuses nothing: the unmount lands exactly as it would have at zero.
    await ada.delete(`/worlds/${campaign}/mounts/${shelf}`).expect(200);
    expect((await ada.get(`/worlds/${campaign}/mounts`).expect(200)).body).toEqual([]);
  });

  it('counts a Mount’s links from this World alone, never another World’s', async () => {
    const ada = await signIn('ada@hexly.test');
    const bob = await signIn('bob@hexly.test');
    const sunset = await mintEntity(ada, shelf, 'Sunset over Aldermoor');
    await ada.patch(`/entities/${sunset}`).send({ visibility: 'shared' }).expect(200);
    const tavern = await mintEntity(ada, campaign, 'The Tavern');
    const barrow = await mintEntity(bob, bobWorld, 'The Barrow');
    await link(ada, tavern, [{ entityId: sunset, label: 'Sunset' }]);
    await link(bob, barrow, [{ entityId: sunset, label: 'Sunset' }]);

    // Ada's unmount breaks Ada's link and leaves Bob's exactly where it was, so hers is the only one
    // her confirm may claim.
    expect(await mountLinks(ada, campaign, shelf)).toEqual({ links: 1, worlds: 1 });
  });

  it('says nothing points into a Container rather than counting its own internal links', async () => {
    const ada = await signIn('ada@hexly.test');
    const sunset = await mintEntity(ada, shelf, 'Sunset over Aldermoor');
    const oak = await mintEntity(ada, shelf, 'The Hanging Oak');
    // A link *within* the shelf survives every one of the three acts, so it is never blast radius.
    await link(ada, oak, [{ entityId: sunset, label: 'Sunset' }]);
    // As does a link that already dangles: it breaks nothing further, so counting it would overstate.
    const tavern = await mintEntity(ada, campaign, 'The Tavern');
    await link(ada, tavern, [{ entityId: randomUUID(), label: 'A note that went away' }]);

    expect(await mountLinks(ada, campaign, shelf)).toEqual({ links: 0, worlds: 0 });
    expect(await inboundLinks(ada, shelf)).toEqual({ links: 0, worlds: 0 });
  });

  it('counts the images a World draws from a Container, not just its prose links', async () => {
    const ada = await signIn('ada@hexly.test');
    const hash = 'b'.repeat(64);
    mintAsset(shelf, hash, 'Tavern Interior');
    const tavern = await mintEntity(ada, campaign, 'The Tavern');
    await illustrate(ada, tavern, assetUrl(shelf, hash, '.png'));

    // A **Decor Link** counts (ADR-0069): "every player's Board shows dangling art" is precisely the
    // damage the number exists to state, and it is invisible on the relation surfaces.
    expect(await mountLinks(ada, campaign, shelf)).toEqual({ links: 1, worlds: 1 });
  });

  it('states a Container’s links and how many Worlds they come from, and deletes whatever the count', async () => {
    const ada = await signIn('ada@hexly.test');
    const bob = await signIn('bob@hexly.test');
    const sunset = await mintEntity(ada, shelf, 'Sunset over Aldermoor');
    await ada.patch(`/entities/${sunset}`).send({ visibility: 'shared' }).expect(200);
    const tavern = await mintEntity(ada, campaign, 'The Tavern');
    const road = await mintEntity(ada, campaign, 'The Hollow Road');
    const barrow = await mintEntity(bob, bobWorld, 'The Barrow');
    await link(ada, tavern, [{ entityId: sunset, label: 'Sunset' }]);
    await link(ada, road, [{ entityId: sunset, label: 'Sunset' }]);
    await link(bob, barrow, [{ entityId: sunset, label: 'Sunset' }]);

    // Three links from two Worlds — including Bob's, whom Ada cannot read a thing about. A blast
    // radius that hid what the caller cannot see would understate the damage, and a pair of numbers
    // names no content.
    expect(await inboundLinks(ada, shelf)).toEqual({ links: 3, worlds: 2 });

    await ada.delete(`/worlds/${shelf}`).expect(204);
    await ada.get(`/worlds/${shelf}`).expect(404);
  });

  it('states the same pair to an operator removing a pack, and removes it whatever the count', async () => {
    const ted = await signIn('ted@hexly.test');
    const ada = await signIn('ada@hexly.test');
    const bob = await signIn('bob@hexly.test');
    await install(ted, PACK_ID);
    const packId = (await packRow(ted, PACK_ID)).installed?.id as string;
    const entry = (await ada.get(`/entities?worldId=${packId}`).expect(200)).body.items[0].id as string;
    const tavern = await mintEntity(ada, campaign, 'The Tavern');
    const barrow = await mintEntity(bob, bobWorld, 'The Barrow');
    await link(ada, tavern, [{ entityId: entry, label: 'Goblin' }]);
    await link(bob, barrow, [{ entityId: entry, label: 'Goblin' }]);

    // The operator sees what a World Owner deleting their own Container sees — same pair, same footing.
    expect((await ted.get(`/admin/compendiums/${PACK_ID}/inbound-links`).expect(200)).body).toEqual({
      links: 2,
      worlds: 2,
    });

    await ted.delete(`/admin/compendiums/${PACK_ID}`).expect(204);
    expect(await packRow(ted, PACK_ID)).not.toHaveProperty('installed');
  });

  it('counts zero for a pack the Instance offers but has never installed, and 404s for one it does not', async () => {
    const ted = await signIn('ted@hexly.test');
    // Nothing on the shelf is nothing to point into — honest zero, not a 404 the panel would toast.
    expect((await ted.get(`/admin/compendiums/${PACK_ID}/inbound-links`).expect(200)).body).toEqual({
      links: 0,
      worlds: 0,
    });
    await ted.get('/admin/compendiums/test.importer.nope/inbound-links').expect(404);
  });

  it('reads the count per act rather than storing it, so a co-author’s save is already in the answer', async () => {
    const ada = await signIn('ada@hexly.test');
    const sunset = await mintEntity(ada, shelf, 'Sunset over Aldermoor');
    const tavern = await mintEntity(ada, campaign, 'The Tavern');
    await mount(ada, campaign, shelf);
    expect(await mountLinks(ada, campaign, shelf)).toEqual({ links: 0, worlds: 0 });

    // No act between the two reads — only a save. A stored count would still be saying zero.
    await link(ada, tavern, [{ entityId: sunset, label: 'Sunset' }]);
    expect(await mountLinks(ada, campaign, shelf)).toEqual({ links: 1, worlds: 1 });

    // And it falls again on its own, with nothing to invalidate.
    await link(ada, tavern, []);
    expect(await mountLinks(ada, campaign, shelf)).toEqual({ links: 0, worlds: 0 });
  });

  it('leaves the broken links dangling rather than erroring — a target that has gone, nothing more', async () => {
    const ada = await signIn('ada@hexly.test');
    const sunset = await mintEntity(ada, shelf, 'Sunset over Aldermoor');
    const tavern = await mintEntity(ada, campaign, 'The Tavern');
    await mount(ada, campaign, shelf);
    await link(ada, tavern, [{ entityId: sunset, label: 'Sunset over Aldermoor' }]);

    await ada.delete(`/worlds/${shelf}`).expect(204);

    // The Entity still opens, its References still answer, and the broken edge reads as a target that
    // is not there — which is what a dangling **Entity Link** has always been (CONTEXT.md → Entity
    // Link). The last-known label is the client's, carried in the document the link was written into.
    await ada.get(`/entities/${tavern}`).expect(200);
    const { references } = (await ada.get(`/entities/${tavern}/references`).expect(200)).body;
    expect(references).toEqual([expect.objectContaining({ target: null })]);
    const document = (await ada.get(`/entities/${tavern}`).expect(200)).body.document;
    expect(JSON.stringify(document)).toContain('Sunset over Aldermoor');
  });

  it('degrades for the reader who can no longer reach the target, and errors for neither side', async () => {
    const ada = await signIn('ada@hexly.test');
    const sunset = await mintEntity(ada, shelf, 'Sunset over Aldermoor');
    await ada.patch(`/entities/${sunset}`).send({ visibility: 'shared' }).expect(200);
    const tavern = await mintEntity(ada, campaign, 'The Tavern');
    await ada.patch(`/entities/${tavern}`).send({ visibility: 'shared' }).expect(200);
    await link(ada, tavern, [{ entityId: sunset, label: 'Sunset over Aldermoor' }]);
    await ada.post(`/worlds/${campaign}/members`).send({ userId: await idOf('bob@hexly.test'), role: 'viewer' });

    // Bob reads the campaign and cannot reach the shelf — the state an unmount leaves every reader but
    // the Owner in, and the whole of what "the links stop working for everyone else" means.
    const bob = await signIn('bob@hexly.test');
    await bob.get(`/entities/${tavern}`).expect(200);
    const { references } = (await bob.get(`/entities/${tavern}/references`).expect(200)).body;
    // A target he may not read is a target that is not there: no row leaks, nothing 403s or 500s, and
    // the label the client renders it non-navigable with rides the document he already has.
    expect(references).toEqual([expect.objectContaining({ target: null })]);
    expect(JSON.stringify((await bob.get(`/entities/${tavern}`).expect(200)).body.document)).toContain(
      'Sunset over Aldermoor',
    );
    // And the Owner's own view is untouched, which is the asymmetry the unmount wording exists for.
    const owner = (await ada.get(`/entities/${tavern}/references`).expect(200)).body;
    expect(owner.references).toEqual([expect.objectContaining({ target: expect.objectContaining({ id: sunset }) })]);
  });

  it('gates each count exactly like the act it precedes, refusal for refusal', async () => {
    const ada = await signIn('ada@hexly.test');
    await mount(ada, campaign, shelf);

    // Asserted as parity rather than as literal codes: whatever the act answers a caller who may not
    // perform it, asking what it would cost answers the same. Nobody learns from the count what the
    // act would not have told them.
    const stranger = await signIn('bob@hexly.test');
    expect(await status(stranger, 'get', `/worlds/${campaign}/mounts/${shelf}/inbound-links`)).toBe(
      await status(stranger, 'delete', `/worlds/${campaign}/mounts/${shelf}`),
    );
    expect(await status(stranger, 'get', `/worlds/${campaign}/inbound-links`)).toBe(
      await status(stranger, 'delete', `/worlds/${campaign}`),
    );

    await ada.post(`/worlds/${campaign}/members`).send({ userId: await idOf('bob@hexly.test'), role: 'viewer' });
    const viewer = await signIn('bob@hexly.test');
    expect(await status(viewer, 'get', `/worlds/${campaign}/mounts/${shelf}/inbound-links`)).toBe(
      await status(viewer, 'delete', `/worlds/${campaign}/mounts/${shelf}`),
    );
    expect(await status(viewer, 'get', `/worlds/${campaign}/inbound-links`)).toBe(
      await status(viewer, 'delete', `/worlds/${campaign}`),
    );

    // A pack's count is the operator's, like every other route on that surface.
    expect(await status(ada, 'get', `/admin/compendiums/${PACK_ID}/inbound-links`)).toBe(
      await status(ada, 'delete', `/admin/compendiums/${PACK_ID}`),
    );
  });

  // ---- harness -------------------------------------------------------------

  async function seed(email: string, name: string): Promise<string> {
    return app.get(AuthService).seedUser(email, 'correct horse', name, { roles: ['create-worlds'] });
  }

  /** The id the seeded account got, for the routes that take a user rather than a session. */
  async function idOf(email: string): Promise<string> {
    const agent = await signIn(email);
    return (await agent.get('/auth/me').expect(200)).body.id;
  }

  async function signIn(email: string) {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/auth/login').send({ email, password: 'correct horse' }).expect(200);
    return agent;
  }

  type Agent = Awaited<ReturnType<typeof signIn>>;

  async function mintWorld(agent: Agent, name: string): Promise<string> {
    return (await agent.post('/worlds').send({ name }).expect(201)).body.id;
  }

  async function mintEntity(agent: Agent, worldId: string, name: string): Promise<string> {
    return (
      await agent
        .post('/entities')
        .send({ name, types: ['core.type.note'], worldId })
        .expect(201)
    ).body.id;
  }

  async function mount(agent: Agent, worldId: string, containerId: string): Promise<void> {
    await agent.post(`/worlds/${worldId}/mounts`).send({ containerId }).expect(200);
  }

  /** Save `id`'s RichContent as prose holding one `entityLink` per entry — the harvest's input. */
  async function link(owner: Agent, id: string, links: Record<string, unknown>[]): Promise<void> {
    const current = (await owner.get(`/entities/${id}`).expect(200)).body;
    const document: EntityDocument = {
      'core.field.content': tiptapContent({
        type: 'doc',
        content: [{ type: 'paragraph', content: links.map((attrs) => ({ type: 'entityLink', attrs })) }],
      }),
    };
    await owner.put(`/entities/${id}`).send({ document, version: current.version, tags: [] }).expect(200);
  }

  /** Save `id`'s RichContent as prose holding one `image` — which harvests as a Decor asset edge. */
  async function illustrate(owner: Agent, id: string, src: string): Promise<void> {
    const current = (await owner.get(`/entities/${id}`).expect(200)).body;
    const document: EntityDocument = {
      'core.field.content': tiptapContent({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src } }] }],
      }),
    };
    await owner.put(`/entities/${id}`).send({ document, version: current.version, tags: [] }).expect(200);
  }

  /**
   * Seed an Asset Entity and its `(containerId, hash)` dedup-index row — the shape mint-and-dedup
   * leaves behind (ADR-0065), written straight to the DB so this spec need not carry the upload path.
   */
  function mintAsset(containerId: string, hash: string, name: string): void {
    const id = randomUUID();
    const now = Date.now();
    db.insert(entities)
      .values({
        id,
        containerId,
        name,
        types: ['core.type.asset'],
        tags: [],
        visibility: 'shared',
        version: 1,
        document: JSON.stringify({
          'core.field.asset': { hash, ext: '.png', mime: 'image/png', size: 1, stats: null },
          'core.field.content': emptyRichContent(),
        }),
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(assetIndex).values({ entityId: id, containerId, hash, ext: '.png' }).run();
  }

  /** The status a call lands on, so a count's refusal can be compared with its act's. */
  async function status(agent: Agent, method: 'get' | 'delete', path: string): Promise<number> {
    return (await agent[method](path)).status;
  }

  async function mountLinks(agent: Agent, worldId: string, containerId: string): Promise<InboundLinkCount> {
    return (await agent.get(`/worlds/${worldId}/mounts/${containerId}/inbound-links`).expect(200)).body;
  }

  async function inboundLinks(agent: Agent, worldId: string): Promise<InboundLinkCount> {
    return (await agent.get(`/worlds/${worldId}/inbound-links`).expect(200)).body;
  }

  /** Install a pack the way the operator panel does, and wait for the reconcile to land. */
  async function install(operator: Agent, importerId: string): Promise<void> {
    await operator.post(`/admin/compendiums/${importerId}/run`).expect(202);
    for (let attempt = 0; attempt < 50; attempt++) {
      if ((await packRow(operator, importerId)).run.status !== 'running') return;
    }
    throw new Error('the import run never left the running state');
  }

  async function packRow(operator: Agent, importerId: string): Promise<CompendiumPackSummary> {
    const packs = (await operator.get('/admin/compendiums').expect(200)).body as CompendiumPackSummary[];
    return packs.find((p) => p.importer === importerId) as CompendiumPackSummary;
  }
});
