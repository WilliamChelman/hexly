import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { EntityDetail, EntitySummary } from '@hexly/domain';
import { tiptapContent } from '@hexly/plugin-content';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { ConfigModule } from '../config/config.module';
import { DB, Db, createDb } from '../db/db';
import { EntitiesModule } from '../entities/entities.module';
import { EntitiesService } from '../entities/entities.service';
import { CompendiumWrites } from '../worlds/compendium-writes';
import { WorldsModule } from '../worlds/worlds.module';
import { PublicLinksModule } from './public-links.module';

/**
 * A **Mount** cascades read (#410, ADR-0080): a mounted Container's content is readable by whoever can
 * read the mounting World. Asserted at the HTTP seam throughout, because the whole of this ticket is
 * who gets an answer and who gets a 404 — the one thing a service-shaped test would not prove.
 *
 * The cast is the ADR's own: Ada owns the campaign and the shelf it draws from, Bob plays in the
 * campaign, Dan writes in it, and Cara is a member of nothing — the outsider, and the grantee whose
 * thinner standing marks where the cascade stops.
 */
describe('A Mount cascades read', () => {
  let app: INestApplication;
  let db: Db;

  let adaId: string;
  let bobId: string;
  let danId: string;
  let caraId: string;
  /** Ada's campaign, and the Shelf she keeps the art on. */
  let campaign: string;
  let shelf: string;
  /** One installed pack — Instance-wide, and mountable by any World Owner (ADR-0079). */
  let pack: string;

  /** `The Tavern` is the campaign's own; the shelf holds one `shared` painting and one `private` sketch. */
  let tavern: string;
  let sunset: string;
  let sketch: string;
  /** One Compendium Entry, sealed and `private` on the row — reached by the pack's own rule, not by visibility. */
  let goblin: string;

  /** Ada's session, signed in once: she owns everything here, so she declares every Mount. */
  let owner: Awaited<ReturnType<typeof signIn>>;
  const ada = () => owner;

  beforeEach(async () => {
    db = createDb(':memory:'); // Isolated per-test (ADR-0002).

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, AuthModule, WorldsModule, EntitiesModule, PublicLinksModule],
    })
      .overrideProvider(DB)
      .useValue(db)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    // Listen for real: supertest otherwise churns an ephemeral port per request.
    await app.listen(0);

    adaId = await seed('ada@hexly.test', 'Ada');
    bobId = await seed('bob@hexly.test', 'Bob');
    danId = await seed('dan@hexly.test', 'Dan');
    caraId = await seed('cara@hexly.test', 'Cara');

    owner = await signIn('ada@hexly.test');
    campaign = await mintWorld(ada(), 'Aldermoor');
    shelf = await mintWorld(ada(), 'The Art Shelf');
    await ada().post(`/worlds/${campaign}/members`).send({ userId: bobId, role: 'viewer' }).expect(200);
    await ada().post(`/worlds/${campaign}/members`).send({ userId: danId, role: 'contributor' }).expect(200);

    tavern = await mintEntity(ada(), campaign, 'The Tavern');
    await share(ada(), tavern);
    sunset = await mintEntity(ada(), shelf, 'Sunset over Aldermoor', 'A long red evening above the marsh road.');
    await share(ada(), sunset);
    sketch = await mintEntity(ada(), shelf, 'Rough Sketch');

    pack = app.get(CompendiumWrites).install('draw-steel.importer.monsters', { name: 'Draw Steel: Monsters' }, '1.4.0');
    goblin = seedEntry('Goblin Warrior', 'Guards the sunken larder.');
  });

  afterEach(async () => {
    await app.close();
  });

  it('opens a mounted Entity to a Viewer of the mounting World, and closes it again on unmount', async () => {
    const bob = await signIn('bob@hexly.test');

    // Before the Mount the shelf is not there at all — unreachable is indistinguishable from
    // nonexistent, for the Container as much as for its content (ADR-0004).
    await bob.get(`/entities/${sunset}`).expect(404);
    await bob.get(`/worlds/${shelf}`).expect(404);

    await mount(campaign, shelf);

    // One hop later the painting is his to read, and so is the Container it hangs in: Entity URLs are
    // World-scoped (ADR-0028), so following a link into a Mount lands on the content's own World.
    expect(((await bob.get(`/entities/${sunset}`).expect(200)).body as EntityDetail).name).toBe(
      'Sunset over Aldermoor',
    );
    expect((await bob.get(`/worlds/${shelf}`).expect(200)).body.rights).toEqual(['read']);

    // The cascade rides the same `shared` line a World Viewer's read does, so Ada's private sketch
    // stays Ada's — a Mount republishes what the shelf publishes, not everything on it.
    await bob.get(`/entities/${sketch}`).expect(404);

    // Unmounting withdraws the reach with the declaration.
    await unmount(campaign, shelf);
    await bob.get(`/entities/${sunset}`).expect(404);
    await bob.get(`/worlds/${shelf}`).expect(404);
  });

  it('tells someone with no standing in the mounting World nothing at all', async () => {
    const cara = await signIn('cara@hexly.test');
    await mount(campaign, shelf);

    // Cara reaches no World that Mounts the shelf, so the cascade is not hers — and the refusal is a
    // 404 rather than a 403 either way, so a Mount never leaks that the content exists (ADR-0004).
    await cara.get(`/entities/${sunset}`).expect(404);
    await cara.get(`/worlds/${shelf}`).expect(404);
    await cara.get(`/entities/${tavern}`).expect(404);
  });

  it('cascades to the mounting World’s members, and not to a grantee who merely reaches it', async () => {
    // A Viewer grant on one Entity gives Cara ADR-0037's minimal reachability of the campaign (#161) —
    // enough to open what she was given, and never enough to read the campaign's own `shared` surface.
    await ada().post(`/entities/${tavern}/grants`).send({ userId: caraId, role: 'viewer' }).expect(200);
    await mount(campaign, shelf);

    const cara = await signIn('cara@hexly.test');
    await cara.get(`/entities/${tavern}`).expect(200);
    await cara.get(`/worlds/${campaign}`).expect(200);
    // So the Mount does not reach her either: cascading it would grant more *through* the Mount than
    // beside it, which is why the hop tests membership rather than reachability.
    await cara.get(`/entities/${sunset}`).expect(404);
    await cara.get(`/worlds/${shelf}`).expect(404);
  });

  it('goes exactly one hop, so Mounts never chain and a cycle is harmless', async () => {
    const vault = await mintWorld(ada(), 'The Deep Vault');
    const relic = await mintEntity(ada(), vault, 'The Sealed Relic');
    await share(ada(), relic);

    // The campaign draws on the shelf, the shelf draws on the vault, and the vault draws back on the
    // campaign — a cycle, which is harmless precisely because nothing follows it.
    await mount(campaign, shelf);
    await mount(shelf, vault);
    await mount(vault, campaign);

    const bob = await signIn('bob@hexly.test');
    await bob.get(`/entities/${sunset}`).expect(200);
    // Two hops is not a hop: what the shelf draws on is the shelf Owner's configuration, and the set of
    // people who can read the vault must not change when someone else edits their Mount list.
    await bob.get(`/entities/${relic}`).expect(404);
    await bob.get(`/worlds/${vault}`).expect(404);
  });

  it('reaches a Contributor as readily as an Owner', async () => {
    const dan = await signIn('dan@hexly.test');
    await mount(campaign, shelf);

    // A Mount cascades to whoever can *read* the mounting World, so every member role draws on it —
    // the shelf is for the table, not for the Owner alone.
    await dan.get(`/entities/${sunset}`).expect(200);
    await dan.get(`/worlds/${shelf}`).expect(200);
  });

  it('makes mounted content findable, since finding follows reading with no rule of its own', async () => {
    const bob = await signIn('bob@hexly.test');
    expect(await found(bob, 'sunset')).toEqual([]);

    await mount(campaign, shelf);

    // The Command Palette's read: unscoped, navigation, whatever the caller can reach (ADR-0079).
    expect(await found(bob, 'sunset')).toEqual(['Sunset over Aldermoor']);
    // And full-text reaches the prose, so a half-remembered painting is findable by what is in it.
    expect(await found(bob, 'marsh')).toEqual(['Sunset over Aldermoor']);
    // What a Mount does *not* do is put foreign content in a World-scoped listing: the Entity Browser
    // is about what a World holds, and a Mount widens only what it may point at (ADR-0080).
    expect(await names(bob, `worldId=${campaign}`)).toEqual(['The Tavern']);
  });

  it('serves mounted content to the anonymous reader a World Public Link was shared with', async () => {
    const token = (await ada().post(`/worlds/${campaign}/link`).expect(200)).body.token as string;
    await mount(campaign, shelf);
    await mount(campaign, pack);

    // The session shared with an account-less reader shows the shelf art the Board draws on rather than
    // a hole where it was — and the pack's entries, whose Instance-wide rule never asked about
    // visibility, come through the same one hop.
    expect(
      ((await anon().get(`/public/worlds/${token}/entities/${sunset}`).expect(200)).body as EntityDetail).name,
    ).toBe('Sunset over Aldermoor');
    await anon().get(`/public/worlds/${token}/entities/${goblin}`).expect(200);
    // `private` is still `private`: a Public Link exposes a World's shared surface, and a Mount
    // republishes exactly as much of the shelf's.
    await anon().get(`/public/worlds/${token}/entities/${sketch}`).expect(404);

    // A pack's terms must never sit behind a wall its content does not (ADR-0080), so the Compendium
    // page opens to the same reader.
    expect((await anon().get(`/compendiums/${pack}`).expect(200)).body).toMatchObject({
      name: 'Draw Steel: Monsters',
      rev: '1.4.0',
    });

    // The World's public view still lists the World's own — a Mount changes what may be reached, never
    // what a Container-scoped listing holds.
    const view = (await anon().get(`/public/worlds/${token}`).expect(200)).body;
    expect((view.entities as EntitySummary[]).map((e) => e.name)).toEqual(['The Tavern']);

    await unmount(campaign, shelf);
    await anon().get(`/public/worlds/${token}/entities/${sunset}`).expect(404);
  });

  it('confers no write with the read it confers', async () => {
    const bob = await signIn('bob@hexly.test');
    await mount(campaign, shelf);
    await mount(campaign, pack);

    // Reading through a Mount is reading and nothing else: the ordinary write gates refuse exactly as
    // they did, and honestly — Bob can see the painting exists, so 403 rather than 404.
    expect(((await bob.get(`/entities/${sunset}`).expect(200)).body as EntityDetail).rights).toEqual(['read']);
    await bob.patch(`/entities/${sunset}`).send({ name: 'Mine Now' }).expect(403);
    await bob.patch(`/entities/${sunset}`).send({ visibility: 'private' }).expect(403);
    await bob.delete(`/entities/${sunset}`).expect(403);
    // Nor does mounting a World make its Owner-only surfaces the reader's, or make it authorable: the
    // create resolves a World the caller may author in, and answers a mounted one as it always answered
    // a merely-readable one.
    await bob.get(`/worlds/${shelf}/mounts`).expect(403);
    await bob
      .post('/entities')
      .send({ name: 'Interloper', types: ['core.type.note'], worldId: shelf })
      .expect(404);

    // And the seal is the seal: mounting a pack does not unseal it, for its mounter least of all.
    expect(((await ada().get(`/entities/${goblin}`).expect(200)).body as EntityDetail).rights).toEqual(['read']);
    await ada().patch(`/entities/${goblin}`).send({ name: 'Goblin Champion' }).expect(403);
  });

  it('leaves a World that Mounts nothing answering exactly as it did', async () => {
    const bob = await signIn('bob@hexly.test');

    // With no Mounts the model is ADR-0079's sealed one, unchanged — which is what lets one predicate
    // serve both and leaves nothing to reverse.
    expect(await names(bob, `worldId=${campaign}`)).toEqual(['The Tavern']);
    await bob.get(`/entities/${sunset}`).expect(404);
    await bob.get(`/worlds/${shelf}`).expect(404);
    expect(await found(bob, 'sunset')).toEqual([]);
    expect(await worldNames(bob)).toEqual(['Aldermoor']);
  });

  it('leaves what the World *holds* alone, however much it now draws on', async () => {
    await mount(campaign, shelf);
    await mount(campaign, pack);

    // A Mount widens what a World may point at, never what it holds (ADR-0080): the Entity Browser and
    // every other container-scoped reading answer exactly as they did. What a picker offers is the one
    // read that widens, and it is asserted in `mounted-link-targets.controller.spec.ts` (#411).
    expect(await names(ada(), `worldId=${campaign}`)).toEqual(['The Tavern']);
  });

  it('puts the mounted World in its new readers’ Index, since they can now open it', async () => {
    const bob = await signIn('bob@hexly.test');
    expect(await worldNames(bob)).toEqual(['Aldermoor']);

    // Reachability is one rule, and the World Index is one of its readers (ADR-0080): a World reached
    // through a Mount is listed, switchable and openable — read-only, like every other reach it grants.
    await mount(campaign, shelf);
    expect(await worldNames(bob)).toEqual(['Aldermoor', 'The Art Shelf']);
    await unmount(campaign, shelf);
    expect(await worldNames(bob)).toEqual(['Aldermoor']);
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

  /** The reader with no account — possession of a token is their whole credential. */
  function anon() {
    return request(app.getHttpServer());
  }

  async function mintWorld(agent: Agent, name: string): Promise<string> {
    return (await agent.post('/worlds').send({ name }).expect(201)).body.id;
  }

  /** An Entity, optionally carrying a line of prose so full-text has something to reach. */
  async function mintEntity(agent: Agent, worldId: string, name: string, prose?: string): Promise<string> {
    const id = (
      await agent
        .post('/entities')
        .send({ name, types: ['core.type.note'], worldId })
        .expect(201)
    ).body.id as string;
    if (prose) {
      await agent
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

  async function share(agent: Agent, id: string): Promise<void> {
    await agent.patch(`/entities/${id}`).send({ visibility: 'shared' }).expect(200);
  }

  /** One entry on the pack, landed the way a reconcile lands one: the system insert, with an owner grant. */
  function seedEntry(name: string, prose: string): string {
    const id = randomUUID();
    app.get(EntitiesService).importEntity({
      ownerId: adaId,
      containerId: pack,
      id,
      name,
      types: ['core.type.note'],
      tags: [],
      document: {
        'core.field.content': tiptapContent({
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: prose }] }],
        }),
      },
    });
    return id;
  }

  /** Ada declares a Mount — the Own-only rule and its refusals are pinned in `world-mounts.controller.spec.ts`. */
  async function mount(worldId: string, containerId: string): Promise<void> {
    await ada().post(`/worlds/${worldId}/mounts`).send({ containerId }).expect(200);
  }

  async function unmount(worldId: string, containerId: string): Promise<void> {
    await ada().delete(`/worlds/${worldId}/mounts/${containerId}`).expect(200);
  }

  /** The Entity list's answer for a scope, by name — sorted, since these tests are about *which* rows. */
  async function names(agent: Agent, query: string): Promise<string[]> {
    const items: EntitySummary[] = (await agent.get(`/entities?${query}`).expect(200)).body.items;
    return items.map((e) => e.name).sort();
  }

  /** The World Index's answer, by name — what reachability lists, one of the reads a Mount now widens. */
  async function worldNames(agent: Agent): Promise<string[]> {
    return ((await agent.get('/worlds').expect(200)).body as { name: string }[]).map((w) => w.name).sort();
  }

  /** The Command Palette's read: unscoped, navigation, ranked — whatever this caller can reach. */
  async function found(agent: Agent, q: string): Promise<string[]> {
    return names(agent, `q=${q}`);
  }
});
