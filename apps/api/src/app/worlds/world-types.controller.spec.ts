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

/**
 * The World user-defined type surface (ADR-0048, #191): World-Owner-gated CRUD, World scoping, and
 * an Entity carrying a user-defined type filtering/faceting by its Fields. A sibling of
 * `entities.controller.spec`, on the same in-process Nest + `:memory:` harness.
 */
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
});
