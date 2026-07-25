import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { assetUrl, EntityDocument, LinkedEntity, LOCAL_GRAPH_MAX_DEPTH, LocalGraph } from '@hexly/domain';
import { tiptapContent } from '@hexly/plugin-content';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { ConfigModule } from '../config/config.module';
import { DB, Db, createDb } from '../db/db';
import { assetIndex, entities } from '../db/schema';
import { WorldsModule } from '../worlds/worlds.module';
import { EntitiesModule } from './entities.module';

/**
 * `GET /entities/:id/graph` — the **Local Graph** (ADR-0072): the World Graph narrowed to one Entity's
 * neighbourhood, `depth` hops out. Access-filtered like the World-wide read, so the walk only crosses
 * Entities the viewer may see; traversal is undirected and **semantic-only** (ADR-0069), so a Decor Link
 * never widens the picture — only annotates it.
 */
describe('Local Graph', () => {
  let app: INestApplication;
  let db: Db;
  let bobId: string;

  beforeEach(async () => {
    db = createDb(':memory:'); // Isolated per-test (ADR-0002).
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, AuthModule, WorldsModule, EntitiesModule],
    })
      .overrideProvider(DB)
      .useValue(db)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    // Listen for real: supertest otherwise churns an ephemeral port per request, and a reused loopback
    // 4-tuple still in TIME_WAIT is RST as `socket hang up`.
    await app.listen(0);

    await seed('ada@hexly.test', 'Ada');
    bobId = await seed('bob@hexly.test', 'Bob');
  });

  afterEach(async () => {
    await app.close();
  });

  /** The default read: the centre and what it links to directly, nothing further out. */
  it('draws the centre and its direct neighbours at the default depth', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    const ealdred = await makeEntity(ada, world, 'Ealdred');
    const mira = await makeEntity(ada, world, 'Mira');
    const avalon = await makeEntity(ada, world, 'Avalon');
    await link(ada, ealdred, [{ entityId: mira, descriptor: 'spouse' }]);
    await link(ada, mira, [{ entityId: avalon, descriptor: 'born in' }]);

    const graph = await graphOf(ada, ealdred);

    expect(graph.center).toBe(ealdred);
    expect(graph.depth).toBe(1);
    expect(names(graph.nodes)).toEqual(['Ealdred', 'Mira']); // Avalon is two hops out
    expect(drawn(graph)).toEqual(['Ealdred —spouse→ Mira']);
  });

  /** A hop is a hop in either direction: "what is this Entity's neighbourhood" is not a question about authorship. */
  it('walks edges in both directions', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    const mira = await makeEntity(ada, world, 'Mira');
    const ealdred = await makeEntity(ada, world, 'Ealdred');
    await link(ada, ealdred, [{ entityId: mira, descriptor: 'spouse' }]);

    // Nothing points *out* of Mira, so an outbound-only walk would draw her alone.
    const graph = await graphOf(ada, mira);

    expect(names(graph.nodes)).toEqual(['Ealdred', 'Mira']);
    expect(drawn(graph)).toEqual(['Ealdred —spouse→ Mira']);
  });

  /** A deeper read reaches further out, and draws every edge between the nodes it kept. */
  it('reaches one hop further per depth', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    const ealdred = await makeEntity(ada, world, 'Ealdred');
    const mira = await makeEntity(ada, world, 'Mira');
    const avalon = await makeEntity(ada, world, 'Avalon');
    const thornwood = await makeEntity(ada, world, 'Thornwood');
    await link(ada, ealdred, [{ entityId: mira }]);
    await link(ada, mira, [{ entityId: avalon }]);
    await link(ada, avalon, [{ entityId: thornwood }]);

    const two = await graphOf(ada, ealdred, 2);
    expect(two.depth).toBe(2);
    expect(names(two.nodes)).toEqual(['Avalon', 'Ealdred', 'Mira']);
    expect(drawn(two)).toEqual(['Ealdred → Mira', 'Mira → Avalon']);

    const three = await graphOf(ada, ealdred, 3);
    expect(names(three.nodes)).toEqual(['Avalon', 'Ealdred', 'Mira', 'Thornwood']);
    expect(drawn(three)).toEqual(['Avalon → Thornwood', 'Ealdred → Mira', 'Mira → Avalon']);
  });

  /** A reader asking for more depth than exists wants everything, so the ceiling clamps rather than 400s. */
  it('clamps a depth over the ceiling, and refuses a non-positive one', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    const ealdred = await makeEntity(ada, world, 'Ealdred');

    expect((await graphOf(ada, ealdred, 99)).depth).toBe(LOCAL_GRAPH_MAX_DEPTH);
    await ada.get(`/entities/${ealdred}/graph?depth=0`).expect(400);
    await ada.get(`/entities/${ealdred}/graph?depth=deep`).expect(400);
  });

  /**
   * A **Decor Link** (ADR-0069) is presentation, so it never widens the neighbourhood — but one between
   * nodes the semantic walk already reached is carried, flagged, for the client's reveal. That is what
   * keeps the drawing connected: every node has a semantic path to the centre.
   */
  it('never widens the neighbourhood over a Decor Link, but carries one between included nodes', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    const ealdred = await makeEntity(ada, world, 'Ealdred');
    const mira = await makeEntity(ada, world, 'Mira');
    const hash = 'a'.repeat(64);
    const portrait = mintAsset(world, hash, 'Portrait');
    // Ealdred *illustrates* the portrait — a prose image, decor by construction — and mentions Mira,
    // who links the Asset Entity semantically (a curatorial mention, not a thumbnail).
    await save(ada, ealdred, [
      { type: 'entityLink', attrs: { entityId: mira } },
      { type: 'image', attrs: { src: assetUrl(world, hash, '.png') } },
    ]);
    await link(ada, mira, [{ entityId: portrait }]);

    // One hop: the decor edge to the portrait is no bridge, so the Asset stays out.
    const one = await graphOf(ada, ealdred);
    expect(names(one.nodes)).toEqual(['Ealdred', 'Mira']);
    expect(drawn(one)).toEqual(['Ealdred → Mira']);

    // Two hops: Mira's semantic link brings the portrait in, and *then* the decor edge is drawn too.
    const two = await graphOf(ada, ealdred, 2);
    expect(names(two.nodes)).toEqual(['Ealdred', 'Mira', 'Portrait']);
    expect(two.edges).toEqual(
      expect.arrayContaining([{ source: ealdred, target: portrait, descriptor: null, decor: true }]),
    );
    expect(drawn(two)).toEqual(['Ealdred → Mira', 'Ealdred → Portrait', 'Mira → Portrait']);
  });

  /**
   * The walk crosses the graph the *viewer* sees, so a `private` Entity is not a bridge: it is absent as a
   * node, and so is everything only reachable through it — never a ghost node, never a leaked name.
   */
  it('never crosses an Entity the viewer cannot read', async () => {
    const ada = await signIn('ada@hexly.test');
    const bob = await signIn('bob@hexly.test');
    const world = await makeWorld(ada);
    await addMember(ada, world, bobId);

    const ealdred = await makeEntity(ada, world, 'Ealdred');
    await share(ada, ealdred);
    const cabal = await makeEntity(ada, world, 'Secret Cabal Roster'); // private by default
    const meeting = await makeEntity(ada, world, 'The Ninth Accord');
    await share(ada, meeting);
    await link(ada, ealdred, [{ entityId: cabal }]);
    await link(ada, cabal, [{ entityId: meeting }]);

    // Ada owns everything: the roster bridges Ealdred to the accord two hops out.
    const asAda = await graphOf(ada, ealdred, 2);
    expect(names(asAda.nodes)).toEqual(['Ealdred', 'Secret Cabal Roster', 'The Ninth Accord']);

    // Bob may read both public ends but not the bridge — so he sees Ealdred alone, not a ghost node
    // and not the accord the roster would have carried him to.
    const asBob = await graphOf(bob, ealdred, 2);
    expect(names(asBob.nodes)).toEqual(['Ealdred']);
    expect(asBob.edges).toEqual([]);
  });

  /** The centre is always a node, even with nothing linked to it — a graph of one. */
  it('draws an unlinked Entity as itself alone', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    const isle = await makeEntity(ada, world, 'Unvisited Isle');

    const graph = await graphOf(ada, isle);

    expect(names(graph.nodes)).toEqual(['Unvisited Isle']);
    expect(graph.edges).toEqual([]);
  });

  /** The same existence-preserving gate as the Entity read: unreachable is indistinguishable from absent. */
  it('404s for an Entity the caller cannot reach', async () => {
    const ada = await signIn('ada@hexly.test');
    const bob = await signIn('bob@hexly.test');
    const world = await makeWorld(ada);
    const ealdred = await makeEntity(ada, world, 'Ealdred'); // private by default

    await bob.get(`/entities/${ealdred}/graph`).expect(404);
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

  async function makeWorld(owner: Agent, name = 'Aldermoor'): Promise<string> {
    return (await owner.post('/worlds').send({ name }).expect(201)).body.id;
  }

  async function makeEntity(owner: Agent, worldId: string, name: string): Promise<string> {
    return (
      await owner
        .post('/entities')
        .send({ name, types: ['core.type.note'], worldId })
        .expect(201)
    ).body.id;
  }

  /**
   * A `shared` Asset Entity for `hash` and its `(worldId, hash)` dedup-index row — the shape
   * mint-and-dedup leaves behind (ADR-0065), written straight to the DB so this spec need not carry the
   * whole upload path. Returns the Asset's Entity id.
   */
  function mintAsset(worldId: string, hash: string, name: string): string {
    const id = randomUUID();
    const now = Date.now();
    db.insert(entities)
      .values({
        id,
        worldId,
        name,
        types: ['core.type.asset'],
        tags: [],
        visibility: 'shared',
        version: 1,
        document: '{}',
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(assetIndex).values({ entityId: id, worldId, hash }).run();
    return id;
  }

  async function addMember(owner: Agent, worldId: string, userId: string): Promise<void> {
    await owner.post(`/worlds/${worldId}/members`).send({ userId, role: 'contributor' }).expect(200);
  }

  async function share(owner: Agent, id: string): Promise<void> {
    await owner.patch(`/entities/${id}`).send({ visibility: 'shared' }).expect(200);
  }

  /** Save `id`'s Content as prose holding one `entityLink` per entry. */
  async function link(owner: Agent, id: string, links: Record<string, unknown>[]): Promise<void> {
    await save(
      owner,
      id,
      links.map((attrs) => ({ type: 'entityLink', attrs })),
    );
  }

  async function save(owner: Agent, id: string, inline: unknown[]): Promise<void> {
    const current = (await owner.get(`/entities/${id}`).expect(200)).body;
    const document: EntityDocument = {
      'core.field.content': tiptapContent({
        type: 'doc',
        content: [{ type: 'paragraph', content: inline }],
      }),
    };
    await owner.put(`/entities/${id}`).send({ document, version: current.version, tags: [] }).expect(200);
  }

  async function graphOf(viewer: Agent, id: string, depth?: number): Promise<LocalGraph> {
    const query = depth === undefined ? '' : `?depth=${depth}`;
    return (await viewer.get(`/entities/${id}/graph${query}`).expect(200)).body;
  }

  function names(nodes: readonly LinkedEntity[]): string[] {
    return nodes.map((n) => n.name);
  }

  /**
   * Each edge rendered by the *names* at its ends. Edges arrive in uuid order — stable but arbitrary to a
   * test — so the lines are sorted here.
   */
  function drawn({ nodes, edges }: LocalGraph): string[] {
    const name = new Map(nodes.map((n) => [n.id, n.name]));
    return edges
      .map((e) => {
        const arrow = e.descriptor ? `—${e.descriptor}→` : '→';
        return `${name.get(e.source) ?? '?'} ${arrow} ${name.get(e.target) ?? '?'}`;
      })
      .sort();
  }
});
