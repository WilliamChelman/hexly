import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EntityFacets, EntityReferences, EntitySummary, FacetCount } from '@hexly/domain';
import { tiptapContent } from '@hexly/plugin-content';
import { ASSETS_DIR } from '../assets/assets.service';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { ConfigModule } from '../config/config.module';
import { DB, Db, createDb } from '../db/db';
import { EntitiesModule } from '../entities/entities.module';
import { EntitiesService } from '../entities/entities.service';
import { CompendiumWrites } from '../worlds/compendium-writes';
import { WorldsModule } from '../worlds/worlds.module';

/** A tiny valid-enough PNG; only its bytes' identity matters for the content address. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/**
 * Every link picker offers what the World **Mounts** (#411, #416, ADR-0080). The `@` mention picker, the
 * **Entity Link** Field picker, the Board **Embed** picker and the asset pickers — the asset-link control
 * and the Board **Image** chooser — ask one question, *what may this point at?*, through one read, so the
 * widening is asserted once, here, at the read they share: a link target must be in the linking Container
 * or one it Mounts.
 *
 * Driven through `GET /entities` and `GET /entities/facets` for the same reason #400's line is: the
 * scope *is* the read's behaviour, and there is no flag on a row to inspect instead.
 *
 * The cast is ADR-0080's: Ada owns the campaign, the shelf it draws from and every Mount declared
 * here; Bob plays in the campaign and is where the widening meets the cascade it rides.
 */
describe('Every link picker offers what the World Mounts', () => {
  let app: INestApplication;
  let db: Db;

  let adaId: string;
  let bobId: string;
  /** Ada's campaign, the Shelf it draws on, and one installed pack. */
  let campaign: string;
  let shelf: string;
  let pack: string;

  /** Two Goblin Kings answering to one name — the campaign's own, and the shelf's. */
  let ownGoblin: string;
  let shelfGoblin: string;
  /** The shelf's `shared` painting, and Ada's `private` sketch beside it. */
  let sunset: string;
  let sketch: string;
  /** One **Compendium Entry**, sealed by where it lives. */
  let entry: string;
  /** One image Asset each side of the wall — what the asset pickers are asked to offer (#416). */
  let ownArt: string;
  let shelfArt: string;
  let assetsDir: string;

  let ada: Awaited<ReturnType<typeof signIn>>;

  beforeEach(async () => {
    db = createDb(':memory:'); // Isolated per-test (ADR-0002).
    assetsDir = mkdtempSync(join(tmpdir(), 'hexly-mounted-assets-'));

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
    // Listen for real: supertest otherwise churns an ephemeral port per request.
    await app.listen(0);

    adaId = await seed('ada@hexly.test', 'Ada');
    bobId = await seed('bob@hexly.test', 'Bob');

    ada = await signIn('ada@hexly.test');
    campaign = await mintWorld('Aldermoor');
    shelf = await mintWorld('The Art Shelf');
    await ada.post(`/worlds/${campaign}/members`).send({ userId: bobId, role: 'viewer' }).expect(200);

    // A long note against a one-word name, so bm25 — which rewards a short document — would put the
    // shelf's Goblin King first on its own. That makes the ranking assertion about the tier, not the fixture.
    ownGoblin = await mintEntity(
      campaign,
      'Goblin King',
      'The tunnels run for miles beneath the hills, and the tribe that dug them has held the lower galleries for six generations without once coming up for air.',
    );
    await share(ownGoblin);
    shelfGoblin = await mintEntity(shelf, 'Goblin King');
    await share(shelfGoblin);
    sunset = await mintEntity(shelf, 'Sunset over Aldermoor');
    await share(sunset);
    sketch = await mintEntity(shelf, 'Rough Sketch');

    // One image Asset each side, uploaded the ordinary way so each carries real content-addressed bytes
    // in its own Container — identical bytes, so only the Container tells the two URLs apart (#416).
    ownArt = await upload(campaign, 'Tavern Sign.png');
    shelfArt = await upload(shelf, 'Sunset.png');

    pack = app.get(CompendiumWrites).install('draw-steel.importer.monsters', { name: 'Draw Steel: Monsters' }, '1.4.0');
    entry = seedEntry('Goblin Warrior');
  });

  afterEach(async () => {
    await app.close();
    rmSync(assetsDir, { recursive: true, force: true });
  });

  it('offers a mounted shelf’s Entities beside the World’s own, and neither of them unmounted', async () => {
    // Unmounted, the shelf is not among the answers at all — the sealed model, which an empty Mount
    // set reproduces exactly (ADR-0079, ADR-0080).
    expect(await offeredIds(ada, `worldId=${campaign}`)).toEqual([ownGoblin]);

    await mount(campaign, shelf);

    // Mounted, its Entities are offered inline — not behind a scope switch, which would make the user
    // choose a haystack before searching it — and behind the World's own, whatever the shelf's recency says.
    const offers = await offeredIds(ada, `worldId=${campaign}`);
    expect(offers[0]).toBe(ownGoblin);
    expect(offers.slice(1).sort()).toEqual([shelfGoblin, sketch, sunset].sort());

    // Unmounting withdraws the offer with the declaration.
    await unmount(campaign, shelf);
    expect(await offeredIds(ada, `worldId=${campaign}`)).toEqual([ownGoblin]);
  });

  it('ranks the World’s own Entity above the mounted one at equal relevance', async () => {
    await mount(campaign, shelf);

    // Both match "goblin king" on the name field, and the shelf's is the shorter document: the tier,
    // not bm25, decides that your own goblin king comes before the shelf's.
    expect(await offeredIds(ada, `worldId=${campaign}&q=goblin king`)).toEqual([ownGoblin, shelfGoblin]);
  });

  it('offers a mounted Compendium’s entries, and never an unmounted one’s', async () => {
    // Unmounted: the seal's no-link half, exactly as #400 drew it.
    expect(await offered(ada, `worldId=${campaign}&q=goblin`)).toEqual(['Goblin King']);

    await mount(campaign, pack);

    // Mounted, a pack's entries are things this World may point at — the half of the seal that is now
    // the Mount scope, a property of the pointing World rather than of the entry (ADR-0080).
    expect(await offered(ada, `worldId=${campaign}&q=goblin`)).toEqual(['Goblin King', 'Goblin Warrior']);
    // ...and it is still sealed where sealing means *writing*: mounting unseals nothing.
    await ada.patch(`/entities/${entry}`).send({ name: 'Goblin Champion' }).expect(403);

    // A read that names no Container has no Mount set to resolve, so it stays sealed whatever is
    // mounted anywhere (#400) — the `@` picker carries a World, and the rule must not *depend* on it.
    expect(await offered(ada, `q=goblin`)).not.toContain('Goblin Warrior');
    // The navigation read is untouched throughout: half a remembered name still reaches the entry.
    expect(await names(ada, `q=goblin`)).toEqual(['Goblin King', 'Goblin King', 'Goblin Warrior']);
  });

  it('narrows to one mounted Container through the Container facet, counting what it lists', async () => {
    await mount(campaign, shelf);
    await mount(campaign, pack);

    // The facet a widened read grows: one row per Container still holding an answer, labelled with the
    // Container's own name — so the rail reads "The Art Shelf", not a uuid — the World's own first,
    // then the Mounts in the Owner's order (ADR-0080), as the Library reads them.
    expect(await containerFacet(ada, `worldId=${campaign}&q=goblin`)).toEqual([
      { value: campaign, label: 'Aldermoor', count: 1 },
      { value: shelf, label: 'The Art Shelf', count: 1 },
      { value: pack, label: 'Draw Steel: Monsters', count: 1 },
    ]);

    // Selecting one narrows the list to that Container — one pack, or one shelf — and the count it was
    // annotated with is the number of rows it narrows to, because both come off the same predicates.
    expect(await offered(ada, `worldId=${campaign}&q=goblin&container=${shelf}`)).toEqual(['Goblin King']);
    expect(await offered(ada, `worldId=${campaign}&q=goblin&container=${pack}`)).toEqual(['Goblin Warrior']);
    // A Container the scope does not reach is reachable by naming it no more than it was: both AND.
    expect(await offered(ada, `worldId=${shelf}&q=goblin&container=${pack}`)).toEqual([]);

    // A World that Mounts nothing spans one Container, so there is nothing to narrow and no category.
    expect(await containerFacet(ada, `worldId=${shelf}&q=goblin`)).toBeUndefined();
  });

  it('offers a mounted Entity to a player of the mounting World, on the terms the cascade grants', async () => {
    const bob = await signIn('bob@hexly.test');
    await mount(campaign, shelf);

    // The widening rides the read cascade (#410) rather than replacing it: Bob may point at what the
    // shelf publishes, and Ada's `private` sketch is no more offered to him than it is readable.
    const offers = await offeredIds(bob, `worldId=${campaign}`);
    expect(offers[0]).toBe(ownGoblin);
    expect(offers.slice(1).sort()).toEqual([shelfGoblin, sunset].sort());
    await bob.get(`/entities/${sketch}`).expect(404);
  });

  it('mints a working link to a mounted Entity, resolvable where it is used', async () => {
    await mount(campaign, shelf);
    const note = await mintEntity(campaign, 'The Tavern');

    // Pointing at what the picker offered: the link is minted straight against the id, and the write
    // takes it — the Mount scope is a scope on discovery, never a gate at the write (ADR-0079/0080).
    await ada
      .put(`/entities/${note}`)
      .send({
        document: {
          'core.field.content': tiptapContent({
            type: 'doc',
            content: [
              { type: 'paragraph', content: [{ type: 'entityLink', attrs: { entityId: sunset, label: 'Sunset' } }] },
            ],
          }),
        },
        version: 1,
        tags: [],
      })
      .expect(200);

    // And it renders where it is used: an id resolution is a navigation read, so the target resolves
    // to its live name across the Container boundary.
    expect(await names(ada, `ids=${sunset}`)).toEqual(['Sunset over Aldermoor']);
    // The edge is an ordinary one in both directions — and backlinks cross the boundary (ADR-0080),
    // which is the surface that answers "may I take this off the shelf?".
    const outbound: EntityReferences = (await ada.get(`/entities/${note}/references`).expect(200)).body;
    expect(outbound.references.map((r) => r.target?.name)).toEqual(['Sunset over Aldermoor']);
    const inbound: EntityReferences = (await ada.get(`/entities/${sunset}/references`).expect(200)).body;
    expect(inbound.referencedBy.map((r) => r.source.name)).toEqual(['The Tavern']);
  });

  it('widens what the World points at and nothing about what it holds', async () => {
    await mount(campaign, shelf);
    await mount(campaign, pack);

    // Every container-scoped reading is untouched (ADR-0080): the Entity Browser lists what this World
    // holds, and a Mount adds nothing to it.
    expect(await names(ada, `worldId=${campaign}`)).toEqual(['Goblin King']);
    // Its Facets count its own and only its own — one Note and one Asset here, never the shelf's twins.
    expect((await facets(ada, `worldId=${campaign}`)).type).toEqual([
      { value: 'core.type.asset', count: 1 },
      { value: 'core.type.note', count: 1 },
    ]);
    // Nor does it move the World a mounted Entity belongs to.
    expect(
      (await summaries(ada, `worldId=${campaign}&read=link-target`)).find((e) => e.id === shelfGoblin)?.worldId,
    ).toBe(shelf);
  });

  it('offers a mounted shelf’s Assets to the asset pickers, the World’s own first, each URL its own Container’s', async () => {
    // Unmounted, an asset picker is exactly the picker it was: this World's art and no one else's.
    expect((await assetsOffered(ada, `worldId=${campaign}`)).map((a) => a.id)).toEqual([ownArt]);

    await mount(campaign, shelf);

    // Mounted, the shelf's art is offered beside this World's own, and the World's own ranks first —
    // the same outermost tier every other link picker rides, so a shelf cannot drown a campaign.
    const offers = await assetsOffered(ada, `worldId=${campaign}`);
    expect(offers.map((a) => a.id)).toEqual([ownArt, shelfArt]);

    // Each Asset's URLs resolve against *its own* Container, never the reading World's (ADR-0080) —
    // which is what makes a placed shelf image render for every reader of the campaign. Identical bytes,
    // so the hash is shared and only the Container segment differs: the assertion is about the key.
    const file = offers[0].assetUrl?.split('/')[3] ?? '';
    const hash = file.replace(/\.png$/, '');
    expect(offers[0]).toMatchObject({
      assetUrl: `/assets/${campaign}/${file}`,
      thumbnailUrl: `/assets/${campaign}/${hash}.thumb.webp`,
    });
    expect(offers[1]).toMatchObject({
      assetUrl: `/assets/${shelf}/${file}`,
      thumbnailUrl: `/assets/${shelf}/${hash}.thumb.webp`,
    });

    // The Container facet narrows the asset pickers to one, counting what it narrows to.
    expect(await containerFacet(ada, `worldId=${campaign}&type=core.type.asset`)).toEqual([
      { value: campaign, label: 'Aldermoor', count: 1 },
      { value: shelf, label: 'The Art Shelf', count: 1 },
    ]);
    expect((await assetsOffered(ada, `worldId=${campaign}&container=${shelf}`)).map((a) => a.id)).toEqual([shelfArt]);

    // Unmounting withdraws the offer with the declaration.
    await unmount(campaign, shelf);
    expect((await assetsOffered(ada, `worldId=${campaign}`)).map((a) => a.id)).toEqual([ownArt]);
  });

  it('surfaces hidden-from-default-listing Assets in the pickers exactly as it always did', async () => {
    await mount(campaign, shelf);

    // The asset type is hidden from a default listing (ADR-0065), so a link-target read that names no
    // type omits both sides of the wall alike — the widening changes nothing about that.
    expect(await offered(ada, `worldId=${campaign}`)).not.toContain('Sunset');

    // Selecting the type self-lifts the exclusion (what the asset pickers pin), and so does the by-name
    // pickers' explicit opt-in. Both reach the mounted shelf's art, because the lift is about types and
    // the widening is about Containers — one rule each, neither knowing the other.
    expect((await assetsOffered(ada, `worldId=${campaign}`)).map((a) => a.name)).toEqual(['Tavern Sign', 'Sunset']);
    expect(await offered(ada, `worldId=${campaign}&includeHidden=1`)).toContain('Sunset');
  });

  it('leaves the Asset Browser listing this World’s Assets, with its own counts and Facets', async () => {
    await mount(campaign, shelf);

    // The Asset Browser is a container-scoped browse, not a link-target read (ADR-0080): it lists what
    // this World *holds*, and a Mount adds nothing to that — nor to the Facets annotating it.
    expect(await names(ada, `worldId=${campaign}&type=core.type.asset`)).toEqual(['Tavern Sign']);
    expect((await facets(ada, `worldId=${campaign}&type=core.type.asset`)).container).toBeUndefined();
  });

  // ---- harness -------------------------------------------------------------

  async function seed(email: string, name: string): Promise<string> {
    return app.get(AuthService).seedUser(email, 'correct horse', name, { roles: ['create-worlds'] });
  }

  async function signIn(email: string) {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/auth/login').send({ email, password: 'correct horse' }).expect(200);
    return agent;
  }

  type Agent = Awaited<ReturnType<typeof signIn>>;

  async function mintWorld(name: string): Promise<string> {
    return (await ada.post('/worlds').send({ name }).expect(201)).body.id;
  }

  /** An Entity, optionally carrying a line of prose so full-text has something to weigh. */
  async function mintEntity(worldId: string, name: string, prose?: string): Promise<string> {
    const id = (
      await ada
        .post('/entities')
        .send({ name, types: ['core.type.note'], worldId })
        .expect(201)
    ).body.id as string;
    if (prose) {
      await ada
        .put(`/entities/${id}`)
        .send({
          document: {
            'core.field.content': tiptapContent({
              type: 'doc',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: prose }] }],
            }),
          },
          version: 1,
          tags: [],
        })
        .expect(200);
    }
    return id;
  }

  async function share(id: string): Promise<void> {
    await ada.patch(`/entities/${id}`).send({ visibility: 'shared' }).expect(200);
  }

  /** One entry on the pack, landed the way a reconcile lands one: the system insert, with an owner grant. */
  function seedEntry(name: string): string {
    const id = randomUUID();
    app.get(EntitiesService).importEntity({
      ownerId: adaId,
      containerId: pack,
      id,
      name,
      types: ['core.type.note'],
      tags: [],
      document: {},
    });
    return id;
  }

  /** Mint an image Asset in `worldId` the ordinary way (ADR-0065), returning the wrapper Entity's id. */
  async function upload(worldId: string, filename: string): Promise<string> {
    const res = await ada.post(`/worlds/${worldId}/assets`).attach('file', PNG, filename).expect(201);
    return res.body.id as string;
  }

  async function mount(worldId: string, containerId: string): Promise<void> {
    await ada.post(`/worlds/${worldId}/mounts`).send({ containerId }).expect(200);
  }

  async function unmount(worldId: string, containerId: string): Promise<void> {
    await ada.delete(`/worlds/${worldId}/mounts/${containerId}`).expect(200);
  }

  async function summaries(agent: Agent, query: string): Promise<EntitySummary[]> {
    return (await agent.get(`/entities?${query}`).expect(200)).body.items;
  }

  /** A navigation read's answer, by name — sorted, since a navigation read's order is not this file's subject. */
  async function names(agent: Agent, query: string): Promise<string[]> {
    return (await summaries(agent, query)).map((e) => e.name).sort();
  }

  /** What a picker would show, in the order it would show it — the whole point of a link-target read. */
  async function offered(agent: Agent, query: string): Promise<string[]> {
    return (await summaries(agent, `${query}&read=link-target`)).map((e) => e.name);
  }

  /** The same, by id — for the two Entities that answer to one name. */
  async function offeredIds(agent: Agent, query: string): Promise<string[]> {
    return (await summaries(agent, `${query}&read=link-target`)).map((e) => e.id);
  }

  async function facets(agent: Agent, query: string): Promise<EntityFacets> {
    return (await agent.get(`/entities/facets?${query}`).expect(200)).body;
  }

  /**
   * What an asset picker would show: the same link-target read, preset to the asset type — which is also
   * what lifts the hidden-from-default-listing exclusion Assets carry (ADR-0065) — with `thumbnails=1` for
   * the tile it draws and the capability URL it places.
   */
  async function assetsOffered(agent: Agent, query: string): Promise<EntitySummary[]> {
    return summaries(agent, `${query}&type=core.type.asset&thumbnails=1&read=link-target`);
  }

  /** The Container facet on a link-target read — the rail a widened picker offers to narrow by. */
  async function containerFacet(agent: Agent, query: string): Promise<FacetCount[] | undefined> {
    return (await facets(agent, `${query}&read=link-target`)).container;
  }
});
