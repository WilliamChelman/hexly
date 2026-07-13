import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { Metadata } from '@hexly/domain';
import { emptyContent, tiptapContent } from '@hexly/plugin-content';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { ConfigModule } from '../config/config.module';
import { DB, Db, createDb } from '../db/db';
import { WorldsModule } from '../worlds/worlds.module';
import { EntitiesModule } from './entities.module';

/**
 * `GET /entities/:id/references` — the read side of the Entity Link index (ADR-0046).
 *
 * The rows are raw truth (A → B regardless of who may see either); confidentiality lives in the
 * read. Inbound is filtered by the viewer's access to the *source*. Outbound is not filtered — an
 * unreadable or deleted target renders as a non-navigable dangling label.
 */
describe('Entity references', () => {
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

  describe('References (outbound)', () => {
    it('lists the Entity’s links, resolving each target’s current name', async () => {
      const ada = await signIn('ada@hexly.test');
      const world = await makeWorld(ada);
      const mira = await makeEntity(ada, world, 'Mira');
      const ealdred = await makeEntity(ada, world, 'Ealdred');
      await link(ada, ealdred, [{ entityId: mira, descriptor: 'spouse' }]);

      const { references } = await referencesOf(ada, ealdred);

      expect(references).toEqual([
        {
          targetId: mira,
          descriptor: 'spouse',
          target: { id: mira, name: 'Mira', types: ['core.note'] },
        },
      ]);
    });

    /** The edge survives its target's deletion — it just stops resolving. */
    it('reports a deleted target as unresolved rather than dropping the link', async () => {
      const ada = await signIn('ada@hexly.test');
      const world = await makeWorld(ada);
      const mira = await makeEntity(ada, world, 'Mira');
      const ealdred = await makeEntity(ada, world, 'Ealdred');
      await link(ada, ealdred, [{ entityId: mira }]);

      await ada.delete(`/entities/${mira}`).expect(204);

      const { references } = await referencesOf(ada, ealdred);
      expect(references).toEqual([{ targetId: mira, descriptor: null, target: null }]);
    });

    /** Unreadable and deleted are indistinguishable to the viewer — both dangle. */
    it('reports a target the viewer cannot read as unresolved', async () => {
      const ada = await signIn('ada@hexly.test');
      const bob = await signIn('bob@hexly.test');
      const world = await makeWorld(ada);
      await addMember(ada, world, bobId);
      const secret = await makeEntity(ada, world, 'The Cabal'); // private by default
      const town = await makeEntity(ada, world, 'Riverbend');
      await share(ada, town);
      await link(ada, town, [{ entityId: secret }]);

      const asAda = await referencesOf(ada, town);
      expect(asAda.references).toEqual([
        {
          targetId: secret,
          descriptor: null,
          target: { id: secret, name: 'The Cabal', types: ['core.note'] },
        },
      ]);

      const asBob = await referencesOf(bob, town);
      expect(asBob.references).toEqual([{ targetId: secret, descriptor: null, target: null }]);
    });

    /**
     * A Hex, a Feature, and a Region each carry an Entity Link, harvested through the Structured
     * Field `core.hexmap` declares (ADR-0050). Covers the generic path end to end: the Entity's
     * types must resolve to the `grid` Field and `core.hex-grid` must be registered, or a map's
     * placements harvest to nothing at all.
     */
    it('harvests a Hex, Feature, and Region link off the grid Field, descriptor-less (ADR-0050)', async () => {
      const ada = await signIn('ada@hexly.test');
      const world = await makeWorld(ada);
      const harbour = await makeEntity(ada, world, 'Harbour');
      const riverbend = await makeEntity(ada, world, 'Riverbend');
      const avalon = await makeEntity(ada, world, 'Avalon');
      const map = (
        await ada
          .post('/entities')
          .send({ name: 'The Reach', types: ['core.hexmap'], worldId: world })
          .expect(201)
      ).body;

      await ada
        .put(`/entities/${map.id}`)
        .send({
          version: map.version,
          tags: [],
          document: {
            content: emptyContent(),
            grid: {
              hexes: {
                '0,0': { terrain: 'grass', entityId: harbour },
                '1,0': { terrain: 'grass', feature: { ref: 'settlement', entityId: riverbend } },
              },
              regions: [{ id: 'r1', name: 'Avalon', color: '#aabbcc', hexes: {}, entityId: avalon }],
              labels: [],
            },
          },
        })
        .expect(200);

      const { references } = await referencesOf(ada, map.id);
      expect(references).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ targetId: harbour, descriptor: null }),
          expect.objectContaining({ targetId: riverbend, descriptor: null }),
          expect.objectContaining({ targetId: avalon, descriptor: null }),
        ]),
      );
      expect(references).toHaveLength(3);
      // And the other direction: the linked Note lists the map among its Referenced by.
      const { referencedBy } = await referencesOf(ada, harbour);
      expect(referencedBy).toEqual([
        { descriptor: null, source: { id: map.id, name: 'The Reach', types: ['core.hexmap'] } },
      ]);
    });
  });

  describe('Referenced by (inbound)', () => {
    it('lists the Entities that link here, with the descriptor each used', async () => {
      const ada = await signIn('ada@hexly.test');
      const world = await makeWorld(ada);
      const mira = await makeEntity(ada, world, 'Mira');
      const ealdred = await makeEntity(ada, world, 'Ealdred');
      await link(ada, ealdred, [{ entityId: mira, descriptor: 'spouse' }]);

      const { referencedBy } = await referencesOf(ada, mira);

      expect(referencedBy).toEqual([
        {
          descriptor: 'spouse',
          source: { id: ealdred, name: 'Ealdred', types: ['core.note'] },
        },
      ]);
    });

    /**
     * A `private` source must never appear in another viewer's *Referenced by* for a `shared`
     * target it links — `private` is absolute, with no World Owner or Admin override.
     */
    it('hides a private source from a viewer without access to it', async () => {
      const ada = await signIn('ada@hexly.test');
      const bob = await signIn('bob@hexly.test');
      const world = await makeWorld(ada);
      await addMember(ada, world, bobId);

      const town = await makeEntity(ada, world, 'Riverbend');
      await share(ada, town);
      const cabal = await makeEntity(ada, world, 'Secret Cabal Roster'); // private
      await link(ada, cabal, [{ entityId: town }]);

      // Bob reads the town — the edge exists, and its source is one he may not see.
      const asBob = await referencesOf(bob, town);
      expect(asBob.referencedBy).toEqual([]);

      // Ada, who owns the source, sees it. The rows are the same; only the viewer differs.
      const asAda = await referencesOf(ada, town);
      expect(asAda.referencedBy).toEqual([
        {
          descriptor: null,
          source: {
            id: cabal,
            name: 'Secret Cabal Roster',
            types: ['core.note'],
          },
        },
      ]);
    });

    /** An entity-level Viewer grant pierces `private`, so the same source surfaces for that user. */
    it('shows a private source to a viewer holding a grant on it', async () => {
      const ada = await signIn('ada@hexly.test');
      const bob = await signIn('bob@hexly.test');
      const world = await makeWorld(ada);
      await addMember(ada, world, bobId);

      const town = await makeEntity(ada, world, 'Riverbend');
      await share(ada, town);
      const cabal = await makeEntity(ada, world, 'Secret Cabal Roster');
      await link(ada, cabal, [{ entityId: town }]);

      await ada.post(`/entities/${cabal}/grants`).send({ userId: bobId, role: 'viewer' }).expect(200);

      const { referencedBy } = await referencesOf(bob, town);
      expect(referencedBy).toEqual([
        {
          descriptor: null,
          source: {
            id: cabal,
            name: 'Secret Cabal Roster',
            types: ['core.note'],
          },
        },
      ]);
    });
  });

  /**
   * One target may carry several descriptors and two Entities may share a name, so every ORDER BY
   * ends in an id tiebreak — otherwise these rows swap between reads.
   */
  it('orders References by target name, dangling last, with a stable tiebreak', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    const mira = await makeEntity(ada, world, 'Mira');
    const avalon = await makeEntity(ada, world, 'Avalon');
    const ealdred = await makeEntity(ada, world, 'Ealdred');
    await link(ada, ealdred, [
      { entityId: mira, descriptor: 'spouse' },
      { entityId: 'never-existed' },
      { entityId: avalon },
      { entityId: mira, descriptor: 'rival' },
    ]);

    const { references } = await referencesOf(ada, ealdred);

    expect(
      references.map((r: { target: { name: string } | null; descriptor: string | null }) =>
        r.target ? `${r.target.name}:${r.descriptor ?? ''}` : 'dangling',
      ),
    ).toEqual(['Avalon:', 'Mira:rival', 'Mira:spouse', 'dangling']);
  });

  it('404s for an Entity the caller cannot reach', async () => {
    const ada = await signIn('ada@hexly.test');
    const bob = await signIn('bob@hexly.test');
    const world = await makeWorld(ada);
    const secret = await makeEntity(ada, world, 'The Cabal');

    await bob.get(`/entities/${secret}/references`).expect(404);
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

  async function makeWorld(owner: Agent): Promise<string> {
    return (await owner.post('/worlds').send({ name: 'Aldermoor' }).expect(201)).body.id;
  }

  async function makeEntity(owner: Agent, worldId: string, name: string): Promise<string> {
    return (
      await owner
        .post('/entities')
        .send({ name, types: ['core.note'], worldId })
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
    const current = (await owner.get(`/entities/${id}`).expect(200)).body;
    const document: Metadata = {
      content: tiptapContent({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: links.map((attrs) => ({ type: 'entityLink', attrs })),
          },
        ],
      }),
    };
    await owner.put(`/entities/${id}`).send({ document, version: current.version, tags: [] }).expect(200);
  }

  async function referencesOf(viewer: Agent, id: string) {
    return (await viewer.get(`/entities/${id}/references`).expect(200)).body;
  }
});
