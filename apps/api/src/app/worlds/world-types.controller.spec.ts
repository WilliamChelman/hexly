import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { emptyContent } from '@hexly/domain';
import { DB, Db, createDb } from '../db/db';
import { AuthService } from '../auth/auth.service';
import { AuthModule } from '../auth/auth.module';
import { EntitiesModule } from '../entities/entities.module';
import { TypeFieldRegistry } from '../entities/type-field-registry';
import { ConfigModule } from '../config/config.module';
import { WorldsModule } from './worlds.module';

describe('World user-defined types endpoints', () => {
  let app: INestApplication;
  let db: Db;

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

    await seedUser('ada@hexly.test', 'correct horse', 'Ada');
  });

  afterEach(async () => {
    await app.close();
  });

  /** A user with the World-creation capability. */
  async function seedUser(email: string, password: string, name: string) {
    return app.get(AuthService).seedUser(email, password, name, { roles: ['create-worlds'] });
  }

  /** A bare Instance user (no World-creation) — a member or outsider. */
  async function seedMember(email: string, password: string, name: string) {
    return app.get(AuthService).seedUser(email, password, name);
  }

  async function signIn(email: string, password: string) {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/auth/login').send({ email, password }).expect(200);
    return agent;
  }

  async function makeWorld(agent: request.Agent, name = 'Aldermoor'): Promise<string> {
    const res = await agent.post('/worlds').send({ name }).expect(201);
    return res.body.id;
  }

  const deityType = {
    id: 'world.deity',
    label: 'Deity',
    fields: [
      { key: 'domain', label: 'Domain', dataType: { kind: 'string' }, facetable: true },
      { key: 'alignment', label: 'Alignment', dataType: { kind: 'string' } },
    ],
  };

  describe('Owner-gated CRUD', () => {
    it('lets a World Owner create, list, rename, re-Field, and delete a user-defined type', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await makeWorld(ada);

      const created = await ada.post(`/worlds/${world}/types`).send(deityType).expect(201);
      expect(created.body).toEqual({
        id: 'world.deity',
        label: 'Deity',
        fields: [
          { key: 'domain', label: 'Domain', dataType: { kind: 'string' }, required: false, facetable: true },
          { key: 'alignment', label: 'Alignment', dataType: { kind: 'string' }, required: false, facetable: false },
        ],
      });

      // The available-types read carries it back (source `user`).
      const listed = await ada.get(`/worlds/${world}/types`).expect(200);
      expect(listed.body).toContainEqual(
        expect.objectContaining({ id: 'world.deity', label: 'Deity', source: 'user' }),
      );

      // Rename + replace the Field set wholesale.
      const renamed = await ada
        .patch(`/worlds/${world}/types/world.deity`)
        .send({ label: 'God', fields: [{ key: 'domain', label: 'Portfolio', dataType: { kind: 'string' } }] })
        .expect(200);
      expect(renamed.body.label).toBe('God');
      expect(renamed.body.fields).toEqual([
        { key: 'domain', label: 'Portfolio', dataType: { kind: 'string' }, required: false, facetable: false },
      ]);

      await ada.delete(`/worlds/${world}/types/world.deity`).expect(204);
      const empty = await ada.get(`/worlds/${world}/types`).expect(200);
      expect(empty.body.some((t: { id: string }) => t.id === 'world.deity')).toBe(false);
    });

    it('rejects a non-`world.`-namespaced id and a duplicate-key Field set (400)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await makeWorld(ada);

      await ada.post(`/worlds/${world}/types`).send({ id: 'dnd.monster', label: 'Monster' }).expect(400);
      await ada
        .post(`/worlds/${world}/types`)
        .send({
          id: 'world.thing',
          label: 'Thing',
          fields: [
            { key: 'x', label: 'X', dataType: { kind: 'string' } },
            { key: 'x', label: 'X2', dataType: { kind: 'string' } },
          ],
        })
        .expect(400);
    });

    it('refuses a second type with an id already defined in the World (409)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await makeWorld(ada);

      await ada.post(`/worlds/${world}/types`).send(deityType).expect(201);
      await ada.post(`/worlds/${world}/types`).send({ id: 'world.deity', label: 'Other' }).expect(409);
    });

    it('404s a rename or delete of a type the World has not defined', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await makeWorld(ada);

      await ada.patch(`/worlds/${world}/types/world.ghost`).send({ label: 'Ghost' }).expect(404);
      await ada.delete(`/worlds/${world}/types/world.ghost`).expect(404);
    });

    it('refuses a non-Owner member the CRUD, while letting them read the type set', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await makeWorld(ada);
      await ada.post(`/worlds/${world}/types`).send(deityType).expect(201);

      const bobId = await seedMember('bob@hexly.test', 'correct horse', 'Bob');
      await ada.post(`/worlds/${world}/members`).send({ userId: bobId, role: 'contributor' }).expect(200);
      const bob = await signIn('bob@hexly.test', 'correct horse');

      // A Contributor may read the available types (for the create dialog / facets)…
      const listed = await bob.get(`/worlds/${world}/types`).expect(200);
      expect(listed.body).toContainEqual(expect.objectContaining({ id: 'world.deity' }));
      // …but not author them.
      await bob.post(`/worlds/${world}/types`).send({ id: 'world.faction', label: 'Faction' }).expect(403);
      await bob.patch(`/worlds/${world}/types/world.deity`).send({ label: 'God' }).expect(403);
      await bob.delete(`/worlds/${world}/types/world.deity`).expect(403);
    });

    it('404s every type route for a World the caller cannot reach (no existence leak)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await makeWorld(ada);

      await seedMember('carol@hexly.test', 'correct horse', 'Carol');
      const carol = await signIn('carol@hexly.test', 'correct horse');

      await carol.get(`/worlds/${world}/types`).expect(404);
      await carol.post(`/worlds/${world}/types`).send({ id: 'world.x', label: 'X' }).expect(404);
      await carol.patch(`/worlds/${world}/types/world.deity`).send({ label: 'X' }).expect(404);
      await carol.delete(`/worlds/${world}/types/world.deity`).expect(404);
    });
  });

  describe('World scoping and the available-types merge', () => {
    it('never shows one World’s user-defined types in another World', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const worldA = await makeWorld(ada, 'Fantasy');
      const worldB = await makeWorld(ada, 'Sci-Fi');
      await ada.post(`/worlds/${worldA}/types`).send(deityType).expect(201);

      const inB = await ada.get(`/worlds/${worldB}/types`).expect(200);
      expect(inB.body.some((t: { id: string }) => t.id === 'world.deity')).toBe(false);
    });

    it('lists the instance-wide plugin types alongside a World’s user-defined types', async () => {
      // A bundled plugin registers an instance-wide type at startup (stand-in for a real plugin).
      app
        .get(TypeFieldRegistry)
        .register('test.monster', [{ key: 'cr', label: 'CR', dataType: { kind: 'number' } }], 'Monster');

      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await makeWorld(ada);
      await ada.post(`/worlds/${world}/types`).send(deityType).expect(201);

      const listed = await ada.get(`/worlds/${world}/types`).expect(200);
      expect(listed.body).toContainEqual(
        expect.objectContaining({ id: 'test.monster', label: 'Monster', source: 'plugin' }),
      );
      expect(listed.body).toContainEqual(expect.objectContaining({ id: 'world.deity', source: 'user' }));
    });
  });

  describe('an Entity carrying a user-defined type', () => {
    /** Author the deity type in a fresh World and return the World id. */
    async function worldWithDeity(ada: request.Agent): Promise<string> {
      const world = await makeWorld(ada);
      await ada.post(`/worlds/${world}/types`).send(deityType).expect(201);
      return world;
    }

    it('applies the forward-only gate against the user-defined type’s Fields on a typed edit', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      await worldWithDeity(ada);
      const created = await ada
        .post('/entities')
        .send({ name: 'Nameless', types: ['core.note'] })
        .expect(201);

      // A typed edit ill-types the string `domain` Field — rejected by the world-scoped resolver.
      const res = await ada
        .put(`/entities/${created.body.id}`)
        .send({
          document: { content: emptyContent(), metadata: { domain: 42 } },
          version: 1,
          tags: [],
          types: ['world.deity'],
        })
        .expect(400);
      expect(res.body.code).toBe('invalid-fields');
      expect(res.body.data.fields).toContainEqual({ key: 'domain', code: 'type' });
    });

    it('facets and filters by the user-defined type’s facetable Field', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await worldWithDeity(ada);
      const created = await ada
        .post('/entities')
        .send({ name: 'Pelor', types: ['core.note'] })
        .expect(201);

      // A typed save that carries the type + its Metadata — the facetable `domain` value materialises.
      await ada
        .put(`/entities/${created.body.id}`)
        .send({
          document: { content: emptyContent(), metadata: { domain: 'sun' } },
          version: 1,
          tags: [],
          types: ['world.deity'],
        })
        .expect(200);

      // The Field facet surfaces contextually once `world.deity` is the active Type filter.
      const facets = await ada.get('/entities/facets').query({ worldId: world, type: 'world.deity' }).expect(200);
      expect(facets.body.fields).toContainEqual(
        expect.objectContaining({ key: 'domain', values: [{ value: 'sun', count: 1 }] }),
      );

      // And filtering by that Field returns the Entity.
      const filtered = await ada
        .get('/entities')
        .query({ worldId: world, type: 'world.deity', field: 'domain:eq:sun' })
        .expect(200);
      expect(filtered.body.items.map((e: { id: string }) => e.id)).toContain(created.body.id);
    });

    it('drops the type’s lens on delete, leaving the Entity’s Metadata intact', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await worldWithDeity(ada);
      const created = await ada
        .post('/entities')
        .send({ name: 'Pelor', types: ['world.deity'] })
        .expect(201);
      await ada
        .put(`/entities/${created.body.id}`)
        .send({
          document: { content: emptyContent(), metadata: { domain: 'sun' } },
          version: 1,
          tags: [],
          types: ['world.deity'],
        })
        .expect(200);

      await ada.delete(`/worlds/${world}/types/world.deity`).expect(204);

      // The Entity still reads back, its Metadata untouched — a Field is a lens, not a store.
      const read = await ada.get(`/entities/${created.body.id}`).expect(200);
      expect(read.body.document.metadata).toEqual({ domain: 'sun' });
    });
  });

  describe('a user-defined type carrying a Structured Field', () => {
    /** `world.deity`, plus a `battlemap` grid placed *after* its Fields — a deity opens on its Fields. */
    const deityWithMap = {
      id: 'world.deity',
      label: 'Deity',
      fields: [
        { key: 'domain', label: 'Domain', dataType: { kind: 'string' }, facetable: true },
        { key: 'battlemap', label: 'Battlemap', dataType: { kind: 'core.hex-grid' } },
      ],
      views: ['core.view.fields', 'core.view.content', { field: 'battlemap' }],
    };

    /** One painted hex — the smallest grid that proves the value survived the round trip. */
    const paintedGrid = { hexes: { '0,0': { terrain: 'ocean' } }, regions: [], labels: [] };

    it('stores a hex-grid Field and its View placement, and hands both back', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await makeWorld(ada);

      const created = await ada.post(`/worlds/${world}/types`).send(deityWithMap).expect(201);
      expect(created.body.fields).toContainEqual(
        expect.objectContaining({ key: 'battlemap', dataType: { kind: 'core.hex-grid' } }),
      );
      // The View list round-trips verbatim: the API stores an order it does not resolve.
      expect(created.body.views).toEqual(['core.view.fields', 'core.view.content', { field: 'battlemap' }]);

      const listed = await ada.get(`/worlds/${world}/types`).expect(200);
      expect(listed.body).toContainEqual(
        expect.objectContaining({
          id: 'world.deity',
          source: 'user',
          views: ['core.view.fields', 'core.view.content', { field: 'battlemap' }],
        }),
      );
    });

    it('prunes a stored View placement whose Field a re-Fielding patch dropped', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await makeWorld(ada);
      await ada.post(`/worlds/${world}/types`).send(deityWithMap).expect(201);

      // A caller may legally re-Field a type without re-placing its Views — a patch no payload schema
      // can self-check, since the dropped Field is named only in the *stored* list.
      const patched = await ada
        .patch(`/worlds/${world}/types/world.deity`)
        .send({ fields: [{ key: 'domain', label: 'Domain', dataType: { kind: 'string' } }] })
        .expect(200);

      // The battlemap's placement goes with its Field; the type's own Views survive.
      expect(patched.body.views).toEqual(['core.view.fields', 'core.view.content']);
    });

    it('refuses a Field naming a data-type this build does not register', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await makeWorld(ada);

      // Well-formed, but no plugin ships it — caught at *declaration*, against the composed set.
      const res = await ada
        .post(`/worlds/${world}/types`)
        .send({
          id: 'world.deity',
          label: 'Deity',
          fields: [{ key: 'battlemap', label: 'Battlemap', dataType: { kind: 'core.hex-gird' } }],
        })
        .expect(400);
      expect(res.body.data.fields).toContainEqual({ key: 'battlemap', code: 'unknown-data-type' });
    });

    it('validates and persists the grid the user-defined Field types, and harvests its links', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await makeWorld(ada);
      await ada.post(`/worlds/${world}/types`).send(deityWithMap).expect(201);

      const lair = await ada
        .post('/entities')
        .send({ name: 'The Sunken Keep', types: ['core.note'] })
        .expect(201);
      const pelor = await ada
        .post('/entities')
        .send({ name: 'Pelor', types: ['world.deity'] })
        .expect(201);

      // Refused by the same forward-only gate a `string` Field rides: the write path resolves
      // `core.hex-grid`'s own schema from the bundled plugins, not from a map branch.
      const bad = await ada
        .put(`/entities/${pelor.body.id}`)
        .send({
          document: { content: emptyContent(), metadata: { battlemap: 'not a grid' } },
          version: 1,
          tags: [],
          types: ['world.deity'],
        })
        .expect(400);
      expect(bad.body.data.fields).toContainEqual({ key: 'battlemap', code: 'type' });

      // A well-formed grid saves, links and all.
      await ada
        .put(`/entities/${pelor.body.id}`)
        .send({
          document: {
            content: emptyContent(),
            metadata: {
              domain: 'sun',
              battlemap: { ...paintedGrid, hexes: { '0,0': { terrain: 'ocean', entityId: lair.body.id } } },
            },
          },
          version: 1,
          tags: [],
          types: ['world.deity'],
        })
        .expect(200);

      const read = await ada.get(`/entities/${pelor.body.id}`).expect(200);
      expect(read.body.document.metadata.battlemap.hexes['0,0'].terrain).toBe('ocean');

      // The data-type owns its edges, so a World Owner's map feeds References and the World Graph.
      const refs = await ada.get(`/entities/${lair.body.id}/references`).expect(200);
      expect(refs.body.referencedBy.map((r: { source: { id: string } }) => r.source.id)).toContain(pelor.body.id);
    });

    it('never offers the grid Field as a facet, however it was flagged', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await makeWorld(ada);
      // Ticking `facetable` on a grid buys no facet: a document has no discrete values to count.
      await ada
        .post(`/worlds/${world}/types`)
        .send({
          id: 'world.deity',
          label: 'Deity',
          fields: [{ key: 'battlemap', label: 'Battlemap', dataType: { kind: 'core.hex-grid' }, facetable: true }],
        })
        .expect(201);

      const pelor = await ada
        .post('/entities')
        .send({ name: 'Pelor', types: ['world.deity'] })
        .expect(201);
      await ada
        .put(`/entities/${pelor.body.id}`)
        .send({
          document: { content: emptyContent(), metadata: { battlemap: paintedGrid } },
          version: 1,
          tags: [],
          types: ['world.deity'],
        })
        .expect(200);

      const facets = await ada.get('/entities/facets').query({ worldId: world, type: 'world.deity' }).expect(200);
      expect(facets.body.fields).toEqual([]);
    });
  });
});
