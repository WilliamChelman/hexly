import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DB, Db, createDb } from '../db/db';
import { AuthService } from '../auth/auth.service';
import { AuthModule } from '../auth/auth.module';
import { EntitiesModule } from '../entities/entities.module';
import { ConfigModule } from '../config/config.module';
import { WorldsModule } from './worlds.module';

describe('World user-defined Field endpoints (ADR-0054, #230)', () => {
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

    await app.get(AuthService).seedUser('ada@hexly.test', 'correct horse', 'Ada', { roles: ['create-worlds'] });
  });

  afterEach(async () => {
    await app.close();
  });

  async function seedMember(email: string, name: string) {
    return app.get(AuthService).seedUser(email, 'correct horse', name);
  }

  async function signIn(email: string) {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/auth/login').send({ email, password: 'correct horse' }).expect(200);
    return agent;
  }

  async function makeWorld(agent: request.Agent, name = 'Aldermoor'): Promise<string> {
    const res = await agent.post('/worlds').send({ name }).expect(201);
    return res.body.id;
  }

  const elementField = {
    id: 'world.element',
    key: 'element',
    label: 'Element',
    dataType: { kind: 'enum', options: ['fire', 'ice', 'water'] },
    facetable: true,
  };

  describe('Owner-gated CRUD', () => {
    it('lets a World Owner create, list, re-body, and delete a World-defined Field', async () => {
      const ada = await signIn('ada@hexly.test');
      const world = await makeWorld(ada);

      const created = await ada.post(`/worlds/${world}/fields`).send(elementField).expect(201);
      expect(created.body).toEqual({ ...elementField, required: false });

      const listed = await ada.get(`/worlds/${world}/fields`).expect(200);
      expect(listed.body).toContainEqual(expect.objectContaining({ id: 'world.element', key: 'element' }));

      // Re-body wholesale: the id is immutable (a path param), the body is sent whole.
      const rebodied = await ada
        .patch(`/worlds/${world}/fields/world.element`)
        .send({ key: 'element', label: 'Elemental affinity', dataType: { kind: 'string' } })
        .expect(200);
      expect(rebodied.body).toEqual({
        id: 'world.element',
        key: 'element',
        label: 'Elemental affinity',
        dataType: { kind: 'string' },
        required: false,
        facetable: false,
      });

      await ada.delete(`/worlds/${world}/fields/world.element`).expect(204);
      const empty = await ada.get(`/worlds/${world}/fields`).expect(200);
      expect(empty.body.some((f: { id: string }) => f.id === 'world.element')).toBe(false);
    });

    it('rejects a non-`world.`-namespaced id (400)', async () => {
      const ada = await signIn('ada@hexly.test');
      const world = await makeWorld(ada);
      await ada
        .post(`/worlds/${world}/fields`)
        .send({ ...elementField, id: 'dnd.element' })
        .expect(400);
    });

    it('refuses a second Field with an id already defined in the World (409)', async () => {
      const ada = await signIn('ada@hexly.test');
      const world = await makeWorld(ada);
      await ada.post(`/worlds/${world}/fields`).send(elementField).expect(201);
      await ada
        .post(`/worlds/${world}/fields`)
        .send({ ...elementField, label: 'Other' })
        .expect(409);
    });

    it('404s a re-body or delete of a Field the World has not defined', async () => {
      const ada = await signIn('ada@hexly.test');
      const world = await makeWorld(ada);
      await ada
        .patch(`/worlds/${world}/fields/world.ghost`)
        .send({ key: 'g', label: 'G', dataType: { kind: 'string' } })
        .expect(404);
      await ada.delete(`/worlds/${world}/fields/world.ghost`).expect(404);
    });

    it('refuses a Field naming a data-type this build does not register (400)', async () => {
      const ada = await signIn('ada@hexly.test');
      const world = await makeWorld(ada);
      const res = await ada
        .post(`/worlds/${world}/fields`)
        // A well-formed but unregistered kind (the sibling world-types spec's `core.hex-gird` trick).
        .send({ id: 'world.map', key: 'map', label: 'Map', dataType: { kind: 'core.hex-gird' } })
        .expect(400);
      expect(res.body.data.fields).toContainEqual({ key: 'map', code: 'unknown-data-type' });
    });

    it('refuses a non-Owner member the CRUD, while letting them read the Field set', async () => {
      const ada = await signIn('ada@hexly.test');
      const world = await makeWorld(ada);
      await ada.post(`/worlds/${world}/fields`).send(elementField).expect(201);

      const bobId = await seedMember('bob@hexly.test', 'Bob');
      await ada.post(`/worlds/${world}/members`).send({ userId: bobId, role: 'contributor' }).expect(200);
      const bob = await signIn('bob@hexly.test');

      const listed = await bob.get(`/worlds/${world}/fields`).expect(200);
      expect(listed.body).toContainEqual(expect.objectContaining({ id: 'world.element' }));
      await bob
        .post(`/worlds/${world}/fields`)
        .send({ ...elementField, id: 'world.other' })
        .expect(403);
      await bob
        .patch(`/worlds/${world}/fields/world.element`)
        .send({ key: 'element', label: 'X', dataType: { kind: 'string' } })
        .expect(403);
      await bob.delete(`/worlds/${world}/fields/world.element`).expect(403);
    });

    it('404s every Field route for a World the caller cannot reach (no existence leak)', async () => {
      const ada = await signIn('ada@hexly.test');
      const world = await makeWorld(ada);
      await seedMember('carol@hexly.test', 'Carol');
      const carol = await signIn('carol@hexly.test');

      await carol.get(`/worlds/${world}/fields`).expect(404);
      await carol.post(`/worlds/${world}/fields`).send(elementField).expect(404);
      await carol
        .patch(`/worlds/${world}/fields/world.element`)
        .send({ key: 'element', label: 'X', dataType: { kind: 'string' } })
        .expect(404);
      await carol.delete(`/worlds/${world}/fields/world.element`).expect(404);
    });
  });

  describe('World scoping', () => {
    it('never shows one World’s Fields in another World', async () => {
      const ada = await signIn('ada@hexly.test');
      const worldA = await makeWorld(ada, 'Fantasy');
      const worldB = await makeWorld(ada, 'Sci-Fi');
      await ada.post(`/worlds/${worldA}/fields`).send(elementField).expect(201);

      const inB = await ada.get(`/worlds/${worldB}/fields`).expect(200);
      expect(inB.body.some((f: { id: string }) => f.id === 'world.element')).toBe(false);
    });
  });

  describe('the composed resolver over an Entity’s attached Fields', () => {
    it('resolves an attached World Field, applying its forward-only gate on a typed edit', async () => {
      const ada = await signIn('ada@hexly.test');
      const world = await makeWorld(ada);
      await ada.post(`/worlds/${world}/fields`).send(elementField).expect(201);

      const pelor = await ada
        .post('/entities')
        .send({ name: 'Pelor', types: ['core.note'] })
        .expect(201);

      // A value outside the enum's options is ill-typed — caught by the World-scoped resolver.
      const bad = await ada
        .put(`/entities/${pelor.body.id}`)
        .send({
          document: { element: 'plasma' },
          version: 1,
          tags: [],
          types: ['core.note'],
          fields: ['world.element'],
        })
        .expect(400);
      expect(bad.body.data.fields).toContainEqual({ key: 'element', code: 'type' });

      // A well-formed value saves and is indexed over the effective set — a filter by the attached
      // Field's value finds the Entity, though its type never named the Field.
      await ada
        .put(`/entities/${pelor.body.id}`)
        .send({ document: { element: 'fire' }, version: 1, tags: [], types: ['core.note'], fields: ['world.element'] })
        .expect(200);
      const filtered = await ada.get('/entities').query({ worldId: world, field: 'element:eq:fire' }).expect(200);
      expect(filtered.body.items.map((e: { id: string }) => e.id)).toContain(pelor.body.id);
    });

    it('degrades an Entity referencing a deleted World Field to plain document values (forward-only)', async () => {
      const ada = await signIn('ada@hexly.test');
      const world = await makeWorld(ada);
      await ada.post(`/worlds/${world}/fields`).send(elementField).expect(201);

      const pelor = await ada
        .post('/entities')
        .send({ name: 'Pelor', types: ['core.note'] })
        .expect(201);
      await ada
        .put(`/entities/${pelor.body.id}`)
        .send({ document: { element: 'fire' }, version: 1, tags: [], types: ['core.note'], fields: ['world.element'] })
        .expect(200);

      await ada.delete(`/worlds/${world}/fields/world.element`).expect(204);

      // The value is untouched — a Field is a lens — and a re-save no longer runs the (now-missing) gate.
      const read = await ada.get(`/entities/${pelor.body.id}`).expect(200);
      expect(read.body.document).toEqual({ element: 'fire' });
      await ada
        .put(`/entities/${pelor.body.id}`)
        .send({
          document: { element: 'plasma' },
          version: 2,
          tags: [],
          types: ['core.note'],
          fields: ['world.element'],
        })
        .expect(200);
    });

    it('reuses one World Field across two unrelated types', async () => {
      const ada = await signIn('ada@hexly.test');
      const world = await makeWorld(ada);
      await ada.post(`/worlds/${world}/fields`).send(elementField).expect(201);
      await ada
        .post(`/worlds/${world}/types`)
        .send({
          id: 'world.deity',
          label: 'Deity',
          fields: [{ key: 'domain', label: 'Domain', dataType: { kind: 'string' } }],
        })
        .expect(201);

      // The same Field rides a plain note and a world.deity — reuse across unrelated types.
      const note = await ada
        .post('/entities')
        .send({ name: 'Ember', types: ['core.note'] })
        .expect(201);
      const deity = await ada
        .post('/entities')
        .send({ name: 'Pelor', types: ['world.deity'] })
        .expect(201);
      for (const [id, types] of [
        [note.body.id, ['core.note']],
        [deity.body.id, ['world.deity']],
      ] as const) {
        await ada
          .put(`/entities/${id}`)
          .send({ document: { element: 'ice' }, version: 1, tags: [], types, fields: ['world.element'] })
          .expect(200);
      }

      // One Field, indexed over both regardless of type — a value filter finds them both.
      const filtered = await ada.get('/entities').query({ worldId: world, field: 'element:eq:ice' }).expect(200);
      expect(filtered.body.items.map((e: { id: string }) => e.id)).toEqual(
        expect.arrayContaining([note.body.id, deity.body.id]),
      );
    });
  });
});
