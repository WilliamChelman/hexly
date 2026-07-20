import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { assetUrl, defineField, LinkedEntity, EntityDocument, WorldGraph } from '@hexly/domain';
import { tiptapContent } from '@hexly/plugin-content';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { ConfigModule } from '../config/config.module';
import { DB, Db, createDb } from '../db/db';
import { entities, entityEdges } from '../db/schema';
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
    await app.init();

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
    expect(edges).toEqual([{ source: ealdred, target: mira, descriptor: 'spouse' }]);
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
    expect(asAda.edges).toEqual([{ source: aboleth, target: lair, descriptor: null }]);

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

    it('when the target lives in another World', async () => {
      const ada = await signIn('ada@hexly.test');
      const world = await makeWorld(ada);
      const elsewhere = await makeWorld(ada, 'Thornwood');
      const abroad = await makeEntity(ada, elsewhere, 'Far Shore');
      const ealdred = await makeEntity(ada, world, 'Ealdred');
      await link(ada, ealdred, [{ entityId: abroad }]);

      // The edge is denormalized to its *source's* World, so it comes back in this World's fetch.
      expect(storedEdges()).toEqual([{ source: ealdred, target: abroad, kind: 'entity' }]);

      const { nodes, edges } = await graphOf(ada, world);
      expect(names(nodes)).toEqual(['Ealdred']);
      expect(edges).toEqual([]);
    });

    /** Assets are harvested as edges (ADR-0046) but are never nodes, so they never draw a line. */
    it('when the target is an Asset', async () => {
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

  /** Save `id`'s Content as prose holding one `image` — which harvests as an Asset edge. */
  async function illustrate(owner: Agent, id: string, src: string): Promise<void> {
    await save(owner, id, [{ type: 'image', attrs: { src } }]);
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
