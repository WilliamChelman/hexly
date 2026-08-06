import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { assetUrl, defineField, LinkedEntity, EntityDocument, WorldGraph, WorldGraphNode } from '@hexly/domain';
import { tiptapContent } from '@hexly/plugin-content';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { ConfigModule } from '../config/config.module';
import { DB, Db, createDb } from '../db/db';
import { assetIndex, entities, entityEdges } from '../db/schema';
import { EntitiesModule } from '../entities/entities.module';
import { TypeFieldRegistry } from '../entities/type-field-registry';
import { WorldsModule } from './worlds.module';

/**
 * `GET /worlds/:id/graph` — the node-link picture of a World, read off the derived edge index
 * (ADR-0046). A node appears only if the viewer can read it, and an edge only when the viewer can
 * read *both* endpoints — an edge the viewer cannot fully see is absent, never a ghost node.
 */
describe('World Graph', () => {
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

  it('returns the World’s readable Entities as nodes and their links as edges', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    const mira = await makeEntity(ada, world, 'Mira');
    const ealdred = await makeEntity(ada, world, 'Ealdred');
    await link(ada, ealdred, [{ entityId: mira, descriptor: 'spouse' }]);

    const { nodes, edges } = await graphOf(ada, world);

    expect(nodes).toEqual([
      { id: ealdred, name: 'Ealdred', types: ['core.type.note'] },
      { id: mira, name: 'Mira', types: ['core.type.note'] },
    ]);
    // A prose Entity Link is semantic (ADR-0069): the payload carries the flag; the client filters on it.
    expect(edges).toEqual([{ source: ealdred, target: mira, descriptor: 'spouse', decor: false }]);
  });

  /** A typed Entity-Link Field relation feeds the same edge index as a Content or map link. */
  it('renders an Entity-Link Field relation as a graph edge, hidden when an endpoint is private', async () => {
    const registry = app.get(TypeFieldRegistry);
    registry.registerField(
      defineField({ id: 'test.field.lair', label: 'Lair', dataType: { kind: 'entityLink' }, facetable: false }),
    );
    registry.register('test.type.monster', ['test.field.lair']);
    const ada = await signIn('ada@hexly.test');
    const bob = await signIn('bob@hexly.test');
    const world = await makeWorld(ada);
    await addMember(ada, world, bobId);

    const aboleth = await makeEntity(ada, world, 'Aboleth');
    await share(ada, aboleth);
    const lair = await makeEntity(ada, world, 'The Whisperwood'); // private by default
    await linkField(ada, aboleth, { entityId: lair, label: 'The Whisperwood' });

    // Ada owns both, so the Field relation draws as an edge.
    const asAda = await graphOf(ada, world);
    expect(asAda.edges).toEqual([{ source: aboleth, target: lair, descriptor: null, decor: false }]);

    // Bob cannot read the private lair, so the edge (and its endpoint) drop — nothing dangles.
    const asBob = await graphOf(bob, world);
    expect(names(asBob.nodes)).toEqual(['Aboleth']);
    expect(asBob.edges).toEqual([]);
  });

  /** Nodes are sourced from the accessible-entities query, not the edge table, so orphans appear. */
  it('includes a link-less Entity as an isolated node', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    await makeEntity(ada, world, 'Unvisited Isle');

    const { nodes, edges } = await graphOf(ada, world);

    expect(names(nodes)).toEqual(['Unvisited Isle']);
    expect(edges).toEqual([]);
  });

  /**
   * `private` is absolute (no World Owner or Admin override): the Entity appears neither as a node
   * nor as the bare id at the far end of a line. Both directions of the edge drop.
   */
  it('never leaks a private Entity as a node or as an edge endpoint', async () => {
    const ada = await signIn('ada@hexly.test');
    const bob = await signIn('bob@hexly.test');
    const world = await makeWorld(ada);
    await addMember(ada, world, bobId);

    const town = await makeEntity(ada, world, 'Riverbend');
    await share(ada, town);
    const cabal = await makeEntity(ada, world, 'Secret Cabal Roster'); // private by default
    await link(ada, cabal, [{ entityId: town, descriptor: 'meets in' }]); // private → shared
    await link(ada, town, [{ entityId: cabal }]); // shared → private

    const asBob = await graphOf(bob, world);
    expect(asBob.nodes).toEqual([{ id: town, name: 'Riverbend', types: ['core.type.note'] }]);
    expect(asBob.edges).toEqual([]);

    // The rows are the same; only the viewer differs. Ada, who owns both, sees the whole picture.
    const asAda = await graphOf(ada, world);
    expect(names(asAda.nodes)).toEqual(['Riverbend', 'Secret Cabal Roster']);
    expect(drawn(asAda)).toEqual(['Riverbend → Secret Cabal Roster', 'Secret Cabal Roster —meets in→ Riverbend']);
  });

  /** An entity-level Viewer grant pierces `private`, restoring the node *and* the lines into it. */
  it('shows a private Entity to a viewer holding a grant on it', async () => {
    const ada = await signIn('ada@hexly.test');
    const bob = await signIn('bob@hexly.test');
    const world = await makeWorld(ada);
    await addMember(ada, world, bobId);

    const town = await makeEntity(ada, world, 'Riverbend');
    await share(ada, town);
    const cabal = await makeEntity(ada, world, 'Secret Cabal Roster');
    await link(ada, cabal, [{ entityId: town, descriptor: 'meets in' }]);
    await ada.post(`/entities/${cabal}/grants`).send({ userId: bobId, role: 'viewer' }).expect(200);

    const asBob = await graphOf(bob, world);

    expect(names(asBob.nodes)).toEqual(['Riverbend', 'Secret Cabal Roster']);
    expect(drawn(asBob)).toEqual(['Secret Cabal Roster —meets in→ Riverbend']);
  });

  /**
   * An edge survives only where both endpoints are nodes. Each case first asserts the raw row *is*
   * in the index, so a green means the read dropped the edge, not that nothing was written.
   */
  describe('drops an edge whose target is not a node', () => {
    it('when the target has been deleted', async () => {
      const ada = await signIn('ada@hexly.test');
      const world = await makeWorld(ada);
      const mira = await makeEntity(ada, world, 'Mira');
      const ealdred = await makeEntity(ada, world, 'Ealdred');
      await link(ada, ealdred, [{ entityId: mira }]);
      await ada.delete(`/entities/${mira}`).expect(204);

      // Deleting Mira cascades only her *outbound* rows; `Ealdred → Mira` is keyed by Ealdred.
      expect(storedEdges()).toEqual([{ source: ealdred, target: mira, kind: 'entity' }]);

      const { nodes, edges } = await graphOf(ada, world);
      expect(names(nodes)).toEqual(['Ealdred']); // no ghost node for Mira
      expect(edges).toEqual([]);
    });

    /**
     * An asset edge names a content-addressed hash (ADR-0065); when no Asset Entity holds that hash
     * — never minted, or deleted — the hash resolves to no node, so the reference dangles exactly
     * like a dead `entity` edge rather than drawing a line to nothing.
     */
    it('when the target is an unminted Asset hash', async () => {
      const ada = await signIn('ada@hexly.test');
      const world = await makeWorld(ada);
      const ealdred = await makeEntity(ada, world, 'Ealdred');
      await illustrate(ada, ealdred, assetUrl(world, 'a'.repeat(64), '.png'));

      expect(storedEdges()).toEqual([{ source: ealdred, target: 'a'.repeat(64), kind: 'asset' }]);

      const { nodes, edges } = await graphOf(ada, world);
      expect(names(nodes)).toEqual(['Ealdred']);
      expect(edges).toEqual([]);
    });
  });

  /**
   * An Asset is an ordinary node (ADR-0065): its usage is its inbound links, so the content-addressed
   * asset edge — keyed by hash, not id — resolves through the `(worldId, hash)` dedup index to the
   * Asset's Entity at read time, drawing the line a referencing Entity → Asset should.
   */
  it('renders an Asset as a node with its inbound reference resolved to an edge', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    const ealdred = await makeEntity(ada, world, 'Ealdred');
    const hash = 'a'.repeat(64);
    const portrait = mintAsset(world, hash, 'Portrait');
    await illustrate(ada, ealdred, assetUrl(world, hash, '.png'));

    const { nodes, edges } = await graphOf(ada, world);

    expect(names(nodes)).toEqual(['Ealdred', 'Portrait']);
    expect(drawn({ nodes, edges })).toEqual(['Ealdred → Portrait']);
    // A prose image is decor by construction (ADR-0069): the edge is in the payload, flagged, so the
    // client hides it (and the Asset falls out as an orphan) by default but can reveal it.
    expect(edges).toEqual([{ source: ealdred, target: portrait, descriptor: null, decor: true }]);
  });

  /**
   * A hash names bytes, not an Asset: an identical hash in another World shares no Entity, and a URL
   * naming *this* World reaches only this World's Assets (ADR-0080). A hash alone never crosses.
   */
  it('resolves an asset edge against the World its URL names, not any World holding the bytes', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    const elsewhere = await makeWorld(ada, 'Thornwood');
    const ealdred = await makeEntity(ada, world, 'Ealdred');
    const hash = 'b'.repeat(64);
    // The Asset Entity for this hash lives in the *other* World; the URL names this one.
    mintAsset(elsewhere, hash, 'Portrait');
    await illustrate(ada, ealdred, assetUrl(world, hash, '.png'));

    const { nodes, edges } = await graphOf(ada, world);
    expect(names(nodes)).toEqual(['Ealdred']);
    expect(edges).toEqual([]);
  });

  /**
   * An image whose URL points at another Container's bytes *renders* — the byte route is unauthenticated
   * and takes the Container from the path — so the graph draws it too, or it would quietly disagree with
   * the page (ADR-0080). The Asset is a node of this picture although it is not this World's Entity.
   */
  describe('An image drawn from another Container', () => {
    it('draws the edge, with that Container’s Asset as its far end', async () => {
      const ada = await signIn('ada@hexly.test');
      const world = await makeWorld(ada);
      const shelf = await makeWorld(ada, 'The Shelf');
      const board = await makeEntity(ada, world, 'Mood Board');
      const hash = 'c'.repeat(64);
      const portrait = mintAsset(shelf, hash, 'Shelf Portrait');

      await illustrate(ada, board, assetUrl(shelf, hash, '.png'));

      const { nodes, edges } = await graphOf(ada, world);
      expect(names(nodes)).toEqual(['Mood Board', 'Shelf Portrait']);
      expect(drawn({ nodes, edges })).toEqual(['Mood Board → Shelf Portrait']);
      // Decor by construction, wherever the bytes live — the client's reveal governs it as ever (ADR-0069).
      expect(edges).toEqual([{ source: board, target: portrait, descriptor: null, decor: true }]);
      // And it is a Foreign node: drawn, but marked as the shelf's rather than passed off as this World's.
      expect(foreignNodes(nodes)).toEqual([['Shelf Portrait', shelf]]);
    });

    /**
     * The same through a **Board**, which is the surface this is actually for: its Image elements harvest
     * the very edge a prose image does (ADR-0069).
     */
    it('draws a Board’s Image of another Container’s Asset as a Foreign node', async () => {
      const ada = await signIn('ada@hexly.test');
      const world = await makeWorld(ada);
      const shelf = await makeWorld(ada, 'The Shelf');
      const hash = 'd'.repeat(64);
      const portrait = mintAsset(shelf, hash, 'Shelf Portrait');
      const board = await makeBoard(ada, world, 'Mood Board', assetUrl(shelf, hash, '.png'));

      const { nodes, edges } = await graphOf(ada, world);
      expect(names(nodes)).toEqual(['Mood Board', 'Shelf Portrait']);
      expect(edges).toEqual([{ source: board, target: portrait, descriptor: null, decor: true }]);
      expect(foreignNodes(nodes)).toEqual([['Shelf Portrait', shelf]]);
    });

    /** Both endpoints stay access-filtered: an Asset the viewer cannot read is no node and so no edge. */
    it('draws nothing for a viewer who cannot read the Asset’s Container', async () => {
      const ada = await signIn('ada@hexly.test');
      const bob = await signIn('bob@hexly.test');
      const world = await makeWorld(ada);
      const shelf = await makeWorld(ada, 'The Shelf');
      await addMember(ada, world, bobId);
      const board = await makeEntity(ada, world, 'Mood Board');
      await share(ada, board);
      const hash = 'c'.repeat(64);
      mintAsset(shelf, hash, 'Shelf Portrait');

      await illustrate(ada, board, assetUrl(shelf, hash, '.png'));

      const { nodes, edges } = await graphOf(bob, world);
      expect(names(nodes)).toEqual(['Mood Board']);
      expect(edges).toEqual([]);
    });
  });

  /**
   * A link whose target lives in another Container ends in a **Foreign node** (ADR-0080): drawn, so the
   * connection the author made is visible, and marked with where the thing actually lives, so the picture
   * does not lie about it. The World's *own* nodes stay exactly its own Entities.
   */
  describe('A link leaving the World', () => {
    it('draws its target marked with the Container it lives in', async () => {
      const ada = await signIn('ada@hexly.test');
      const world = await makeWorld(ada);
      const shelf = await makeWorld(ada, 'The Shelf');
      const goblin = await makeEntity(ada, shelf, 'Marauder Goblin');
      const ealdred = await makeEntity(ada, world, 'Ealdred');
      await link(ada, ealdred, [{ entityId: goblin, descriptor: 'hunts' }]);

      // The edge is denormalized to its *source's* World, so it comes back in this World's fetch.
      expect(storedEdges()).toEqual([{ source: ealdred, target: goblin, kind: 'entity' }]);

      const { nodes, edges } = await graphOf(ada, world);
      expect(names(nodes)).toEqual(['Ealdred', 'Marauder Goblin']);
      expect(edges).toEqual([{ source: ealdred, target: goblin, descriptor: 'hunts', decor: false }]);
      // Only the shelf's Entity is marked; this World's own carry no Container at all.
      expect(foreignNodes(nodes)).toEqual([['Marauder Goblin', shelf]]);
    });

    /** Both endpoints stay access-filtered: a Foreign node the viewer cannot read is no node, and so no edge. */
    it('draws nothing for a viewer who cannot read the target', async () => {
      const ada = await signIn('ada@hexly.test');
      const bob = await signIn('bob@hexly.test');
      const world = await makeWorld(ada);
      const shelf = await makeWorld(ada, 'The Shelf');
      await addMember(ada, world, bobId);
      const goblin = await makeEntity(ada, shelf, 'Marauder Goblin');
      const ealdred = await makeEntity(ada, world, 'Ealdred');
      await share(ada, ealdred);
      await link(ada, ealdred, [{ entityId: goblin, descriptor: 'hunts' }]);

      const { nodes, edges } = await graphOf(bob, world);
      expect(names(nodes)).toEqual(['Ealdred']);
      expect(edges).toEqual([]);
    });

    /**
     * The far side of the boundary is another World's picture. This one draws the node it points at and
     * nothing the node itself points at — the edges read here are this World's own, by construction.
     */
    it('draws nothing of the far Container’s own graph', async () => {
      const ada = await signIn('ada@hexly.test');
      const world = await makeWorld(ada);
      const shelf = await makeWorld(ada, 'The Shelf');
      const goblin = await makeEntity(ada, shelf, 'Marauder Goblin');
      const queen = await makeEntity(ada, shelf, 'Goblin Queen');
      await link(ada, goblin, [{ entityId: queen, descriptor: 'serves' }]);
      const ealdred = await makeEntity(ada, world, 'Ealdred');
      await link(ada, ealdred, [{ entityId: goblin, descriptor: 'hunts' }]);

      const { nodes, edges } = await graphOf(ada, world);
      expect(names(nodes)).toEqual(['Ealdred', 'Marauder Goblin']);
      expect(drawn({ nodes, edges })).toEqual(['Ealdred —hunts→ Marauder Goblin']);
    });
  });

  /**
   * `entities.type` is a plain text column, so a row can carry a type this build does not know (an
   * imported vault, say). The node drops and the sieve takes its edges with it; throwing instead
   * would 500 a whole World's graph over one row every other surface renders.
   */
  it('drops an Entity whose stored type is outside the known set, rather than failing the read', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    const mira = await makeEntity(ada, world, 'Mira');
    const ealdred = await makeEntity(ada, world, 'Ealdred');
    await link(ada, ealdred, [{ entityId: mira, descriptor: 'spouse' }]);

    // Written past the API, which would never accept it.
    db.update(entities)
      .set({ types: ['grimoire'] })
      .where(eq(entities.id, mira))
      .run();

    const { nodes, edges } = await graphOf(ada, world);
    expect(names(nodes)).toEqual(['Ealdred']);
    expect(edges).toEqual([]);
  });

  it('404s for a World the caller cannot reach', async () => {
    const ada = await signIn('ada@hexly.test');
    const bob = await signIn('bob@hexly.test');
    const world = await makeWorld(ada);

    await bob.get(`/worlds/${world}/graph`).expect(404);
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

  /** A **Board** whose surface carries one Image element at `src` — the Asset edge a mood board mints. */
  async function makeBoard(owner: Agent, worldId: string, name: string, src: string): Promise<string> {
    const id = (
      await owner
        .post('/entities')
        .send({ name, types: ['core.type.board'], worldId })
        .expect(201)
    ).body.id;
    const geometry = { position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, z: 0 };
    await owner
      .put(`/entities/${id}`)
      .send({
        document: { 'core.field.surface': { elements: [{ id: 'i1', kind: 'image', assetUrl: src, ...geometry }] } },
        version: 1,
        tags: [],
      })
      .expect(200);
    return id;
  }

  /** Save `id`'s Content as prose holding one `image` — which harvests as an Asset edge. */
  async function illustrate(owner: Agent, id: string, src: string): Promise<void> {
    await save(owner, id, [{ type: 'image', attrs: { src } }]);
  }

  /**
   * Seed a `shared` Asset Entity for `hash` and its `(worldId, hash)` dedup-index row — the shape
   * mint-and-dedup leaves behind (ADR-0065), written straight to the DB so this spec need not carry
   * the whole upload path. Returns the Asset's Entity id.
   */
  function mintAsset(worldId: string, hash: string, name: string): string {
    const id = randomUUID();
    const now = Date.now();
    db.insert(entities)
      .values({
        id,
        containerId: worldId,
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
    db.insert(assetIndex).values({ entityId: id, containerId: worldId, hash }).run();
    return id;
  }

  /** Typed-save `id` as a `test.type.monster` whose `lair` Entity-Link Field points at `link` (#190). */
  async function linkField(owner: Agent, id: string, link: { entityId: string; label: string }): Promise<void> {
    const current = (await owner.get(`/entities/${id}`).expect(200)).body;
    await owner
      .put(`/entities/${id}`)
      .send({
        document: { 'core.field.content': tiptapContent({ type: 'doc', content: [] }), 'test.field.lair': link },
        version: current.version,
        tags: [],
        types: ['test.type.monster'],
      })
      .expect(200);
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

  /** The raw index rows, unfiltered by any viewer — the truth the read is supposed to hide. */
  function storedEdges() {
    return db
      .select({
        source: entityEdges.sourceEntityId,
        target: entityEdges.targetId,
        kind: entityEdges.targetKind,
      })
      .from(entityEdges)
      .all();
  }

  async function graphOf(viewer: Agent, worldId: string): Promise<WorldGraph> {
    return (await viewer.get(`/worlds/${worldId}/graph`).expect(200)).body;
  }

  function names(nodes: readonly LinkedEntity[]): string[] {
    return nodes.map((n) => n.name);
  }

  /** Every **Foreign node**, by name and by the Container it is marked as living in. */
  function foreignNodes(nodes: readonly WorldGraphNode[]): [string, string][] {
    return nodes.flatMap((n) => (n.foreignContainerId ? [[n.name, n.foreignContainerId] as [string, string]] : []));
  }

  /**
   * Each edge rendered by the *names* at its ends. Edges arrive in uuid order — stable but
   * arbitrary to a test — so the lines are sorted here.
   */
  function drawn({ nodes, edges }: WorldGraph): string[] {
    const name = new Map(nodes.map((n) => [n.id, n.name]));
    return edges
      .map((e) => {
        const arrow = e.descriptor ? `—${e.descriptor}→` : '→';
        return `${name.get(e.source) ?? '?'} ${arrow} ${name.get(e.target) ?? '?'}`;
      })
      .sort();
  }
});
