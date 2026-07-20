import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
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

  /** POST a World Field so a type can reference it by id (ADR-0054); the type carries `fieldRefs`, never a schema. */
  async function makeField(agent: request.Agent, world: string, field: Record<string, unknown>): Promise<void> {
    await agent.post(`/worlds/${world}/fields`).send(field).expect(201);
  }

  // World-defined Fields a deity type references — the schema lives on the Field, not the type. The
  // server slugs `world.field.<segment>` and pins the document key to it (ADR-0056).
  const domainField = {
    segment: 'domain',
    label: 'Domain',
    dataType: { kind: 'string' },
    facetable: true,
  };
  const alignmentField = { segment: 'alignment', label: 'Alignment', dataType: { kind: 'string' } };

  /** A user-defined type referencing its default Fields by id (ADR-0054). */
  const deityType = {
    id: 'world.type.deity',
    label: 'Deity',
    fieldRefs: ['world.field.domain', 'world.field.alignment'],
  };

  /** Author `world.field.domain` + `world.field.alignment`, then the deity type referencing them, in a fresh World. */
  async function seedDeity(agent: request.Agent): Promise<string> {
    const world = await makeWorld(agent);
    await makeField(agent, world, domainField);
    await makeField(agent, world, alignmentField);
    await agent.post(`/worlds/${world}/types`).send(deityType).expect(201);
    return world;
  }

  describe('Owner-gated CRUD', () => {
    it('lets a World Owner create, list, rename, re-reference, and delete a user-defined type', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await makeWorld(ada);

      const created = await ada.post(`/worlds/${world}/types`).send(deityType).expect(201);
      expect(created.body).toEqual({
        id: 'world.type.deity',
        label: 'Deity',
        // A type declares its default Fields by id only (ADR-0054) — no inline schema echoed back.
        fieldRefs: ['world.field.domain', 'world.field.alignment'],
      });

      // The available-types read carries it back (source `user`).
      const listed = await ada.get(`/worlds/${world}/types`).expect(200);
      expect(listed.body).toContainEqual(
        expect.objectContaining({ id: 'world.type.deity', label: 'Deity', source: 'user' }),
      );

      // Rename + replace the referenced Field set wholesale.
      const renamed = await ada
        .patch(`/worlds/${world}/types/world.type.deity`)
        .send({ label: 'God', fieldRefs: ['world.field.domain'] })
        .expect(200);
      expect(renamed.body.label).toBe('God');
      expect(renamed.body.fieldRefs).toEqual(['world.field.domain']);

      await ada.delete(`/worlds/${world}/types/world.type.deity`).expect(204);
      const empty = await ada.get(`/worlds/${world}/types`).expect(200);
      expect(empty.body.some((t: { id: string }) => t.id === 'world.type.deity')).toBe(false);
    });

    it('rejects a non-`world.`-namespaced id and a malformed fieldRef (400)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await makeWorld(ada);

      await ada.post(`/worlds/${world}/types`).send({ id: 'dnd.type.monster', label: 'Monster' }).expect(400);
      // A `fieldRef` must be a `namespace.field.name` reuse handle, not a bare key.
      await ada
        .post(`/worlds/${world}/types`)
        .send({ id: 'world.type.thing', label: 'Thing', fieldRefs: ['x'] })
        .expect(400);
    });

    it('refuses a second type with an id already defined in the World (409)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await makeWorld(ada);

      await ada.post(`/worlds/${world}/types`).send(deityType).expect(201);
      await ada.post(`/worlds/${world}/types`).send({ id: 'world.type.deity', label: 'Other' }).expect(409);
    });

    it('404s a rename or delete of a type the World has not defined', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await makeWorld(ada);

      await ada.patch(`/worlds/${world}/types/world.type.ghost`).send({ label: 'Ghost' }).expect(404);
      await ada.delete(`/worlds/${world}/types/world.type.ghost`).expect(404);
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
      expect(listed.body).toContainEqual(expect.objectContaining({ id: 'world.type.deity' }));
      // …but not author them.
      await bob.post(`/worlds/${world}/types`).send({ id: 'world.type.faction', label: 'Faction' }).expect(403);
      await bob.patch(`/worlds/${world}/types/world.type.deity`).send({ label: 'God' }).expect(403);
      await bob.delete(`/worlds/${world}/types/world.type.deity`).expect(403);
    });

    it('404s every type route for a World the caller cannot reach (no existence leak)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await makeWorld(ada);

      await seedMember('carol@hexly.test', 'correct horse', 'Carol');
      const carol = await signIn('carol@hexly.test', 'correct horse');

      await carol.get(`/worlds/${world}/types`).expect(404);
      await carol.post(`/worlds/${world}/types`).send({ id: 'world.type.x', label: 'X' }).expect(404);
      await carol.patch(`/worlds/${world}/types/world.type.deity`).send({ label: 'X' }).expect(404);
      await carol.delete(`/worlds/${world}/types/world.type.deity`).expect(404);
    });
  });

  describe('World scoping and the available-types merge', () => {
    it('never shows one World’s user-defined types in another World', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const worldA = await makeWorld(ada, 'Fantasy');
      const worldB = await makeWorld(ada, 'Sci-Fi');
      await ada.post(`/worlds/${worldA}/types`).send(deityType).expect(201);

      const inB = await ada.get(`/worlds/${worldB}/types`).expect(200);
      expect(inB.body.some((t: { id: string }) => t.id === 'world.type.deity')).toBe(false);
    });

    it('lists the instance-wide plugin types alongside a World’s user-defined types', async () => {
      // A bundled plugin registers an instance-wide type at startup (stand-in for a real plugin) —
      // by id, with its default Field ids (ADR-0054); none needed for the merge assertion here.
      app.get(TypeFieldRegistry).register('test.type.monster', [], 'Monster');

      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await makeWorld(ada);
      await ada.post(`/worlds/${world}/types`).send(deityType).expect(201);

      const listed = await ada.get(`/worlds/${world}/types`).expect(200);
      expect(listed.body).toContainEqual(
        expect.objectContaining({ id: 'test.type.monster', label: 'Monster', source: 'plugin' }),
      );
      expect(listed.body).toContainEqual(expect.objectContaining({ id: 'world.type.deity', source: 'user' }));
    });
  });

  describe('an Entity carrying a user-defined type', () => {
    it('applies the forward-only gate against the user-defined type’s referenced Fields on a typed edit', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      await seedDeity(ada);
      const created = await ada
        .post('/entities')
        .send({ name: 'Nameless', types: ['core.type.note'] })
        .expect(201);

      // A typed edit ill-types the string `domain` Field — rejected by the world-scoped resolver, which
      // resolves `world.type.deity`'s `fieldRefs` (→ the World Field `world.field.domain`) to a string data-type.
      const res = await ada
        .put(`/entities/${created.body.id}`)
        .send({
          document: { 'world.field.domain': 42 },
          version: 1,
          tags: [],
          types: ['world.type.deity'],
        })
        .expect(400);
      expect(res.body.code).toBe('invalid-fields');
      expect(res.body.data.fields).toContainEqual({ key: 'world.field.domain', code: 'type' });
    });

    it('facets and filters by the user-defined type’s facetable referenced Field', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await seedDeity(ada);
      const created = await ada
        .post('/entities')
        .send({ name: 'Pelor', types: ['core.type.note'] })
        .expect(201);

      // A typed save that carries the type + its EntityDocument — the facetable `domain` value materialises.
      await ada
        .put(`/entities/${created.body.id}`)
        .send({
          document: { 'world.field.domain': 'sun' },
          version: 1,
          tags: [],
          types: ['world.type.deity'],
        })
        .expect(200);

      // The Field facet surfaces contextually once `world.type.deity` is the active Type filter.
      const facets = await ada.get('/entities/facets').query({ worldId: world, type: 'world.type.deity' }).expect(200);
      expect(facets.body.fields).toContainEqual(
        expect.objectContaining({ key: 'world.field.domain', values: [{ value: 'sun', count: 1 }] }),
      );

      // And filtering by that Field returns the Entity.
      const filtered = await ada
        .get('/entities')
        .query({ worldId: world, type: 'world.type.deity', field: 'world.field.domain:eq:sun' })
        .expect(200);
      expect(filtered.body.items.map((e: { id: string }) => e.id)).toContain(created.body.id);
    });

    it('drops the type’s lens on delete, leaving the Entity’s EntityDocument intact', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await seedDeity(ada);
      const created = await ada
        .post('/entities')
        .send({ name: 'Pelor', types: ['world.type.deity'] })
        .expect(201);
      await ada
        .put(`/entities/${created.body.id}`)
        .send({
          document: { 'world.field.domain': 'sun' },
          version: 1,
          tags: [],
          types: ['world.type.deity'],
        })
        .expect(200);

      await ada.delete(`/worlds/${world}/types/world.type.deity`).expect(204);

      // The Entity still reads back, its EntityDocument untouched — a Field is a lens, not a store.
      const read = await ada.get(`/entities/${created.body.id}`).expect(200);
      expect(read.body.document).toEqual({ 'world.field.domain': 'sun' });
    });
  });

  describe('a user-defined type referencing a Field of a Structured Data Type', () => {
    // The World-defined grid Field, plus a deity type placing it *after* its Fields — a deity opens on
    // its Fields, then its map. The grid schema lives on the Field; the type only references it by id.
    const battlemapField = {
      segment: 'battle-map',
      label: 'Battlemap',
      dataType: { kind: 'core.datatype.hex-grid' },
    };
    const deityWithMap = {
      id: 'world.type.deity',
      label: 'Deity',
      fieldRefs: ['world.field.domain', 'world.field.battle-map'],
      views: ['core.view.fields', 'core.view.rich-content', { field: 'world.field.battle-map' }],
    };

    /** One painted hex — the smallest grid that proves the value survived the round trip. */
    const paintedGrid = { hexes: { '0,0': { terrain: 'ocean' } }, regions: [], labels: [] };

    /** Author the two World Fields, then the deity type referencing them, in a fresh World. */
    async function seedDeityWithMap(agent: request.Agent): Promise<string> {
      const world = await makeWorld(agent);
      await makeField(agent, world, domainField);
      await makeField(agent, world, battlemapField);
      await agent.post(`/worlds/${world}/types`).send(deityWithMap).expect(201);
      return world;
    }

    it('stores the referenced Field ids and its View placement, and hands both back', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await makeWorld(ada);
      await makeField(ada, world, domainField);
      await makeField(ada, world, battlemapField);

      const created = await ada.post(`/worlds/${world}/types`).send(deityWithMap).expect(201);
      expect(created.body.fieldRefs).toEqual(['world.field.domain', 'world.field.battle-map']);
      // The View list round-trips verbatim: the API stores an order it does not resolve.
      expect(created.body.views).toEqual([
        'core.view.fields',
        'core.view.rich-content',
        { field: 'world.field.battle-map' },
      ]);

      const listed = await ada.get(`/worlds/${world}/types`).expect(200);
      expect(listed.body).toContainEqual(
        expect.objectContaining({
          id: 'world.type.deity',
          source: 'user',
          views: ['core.view.fields', 'core.view.rich-content', { field: 'world.field.battle-map' }],
        }),
      );
    });

    it('keeps a stored View placement whose Field a re-referencing patch drops — inert, not pruned (ADR-0054)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await makeWorld(ada);
      await makeField(ada, world, domainField);
      await makeField(ada, world, battlemapField);
      await ada.post(`/worlds/${world}/types`).send(deityWithMap).expect(201);

      // A caller re-references the type without re-placing its Views. The `battlemap` placement no
      // longer resolves (the type no longer references it), but it is left in the stored list — inert
      // at resolution rather than eagerly pruned.
      const patched = await ada
        .patch(`/worlds/${world}/types/world.type.deity`)
        .send({ fieldRefs: ['world.field.domain'] })
        .expect(200);
      expect(patched.body.fieldRefs).toEqual(['world.field.domain']);
      expect(patched.body.views).toEqual([
        'core.view.fields',
        'core.view.rich-content',
        { field: 'world.field.battle-map' },
      ]);
    });

    it('validates and persists the grid the referenced Field types, and harvests its links', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      await seedDeityWithMap(ada);

      const lair = await ada
        .post('/entities')
        .send({ name: 'The Sunken Keep', types: ['core.type.note'] })
        .expect(201);
      const pelor = await ada
        .post('/entities')
        .send({ name: 'Pelor', types: ['world.type.deity'] })
        .expect(201);

      // Refused by the same forward-only gate a `string` Field rides: the write path resolves
      // `core.datatype.hex-grid`'s own schema from the bundled plugins, not from a map branch.
      const bad = await ada
        .put(`/entities/${pelor.body.id}`)
        .send({
          document: { 'world.field.battle-map': 'not a grid' },
          version: 1,
          tags: [],
          types: ['world.type.deity'],
        })
        .expect(400);
      expect(bad.body.data.fields).toContainEqual({ key: 'world.field.battle-map', code: 'type' });

      // A well-formed grid saves, links and all.
      await ada
        .put(`/entities/${pelor.body.id}`)
        .send({
          document: {
            'world.field.domain': 'sun',
            'world.field.battle-map': {
              ...paintedGrid,
              hexes: { '0,0': { terrain: 'ocean', entityId: lair.body.id } },
            },
          },
          version: 1,
          tags: [],
          types: ['world.type.deity'],
        })
        .expect(200);

      const read = await ada.get(`/entities/${pelor.body.id}`).expect(200);
      expect(read.body.document['world.field.battle-map'].hexes['0,0'].terrain).toBe('ocean');

      // The data-type owns its edges, so a World Owner's map feeds References and the World Graph.
      const refs = await ada.get(`/entities/${lair.body.id}/references`).expect(200);
      expect(refs.body.referencedBy.map((r: { source: { id: string } }) => r.source.id)).toContain(pelor.body.id);
    });

    it('never offers the grid Field as a facet, however it was flagged', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await makeWorld(ada);
      // Ticking `facetable` on a grid Field buys no facet: a document has no discrete values to count.
      await makeField(ada, world, { ...battlemapField, facetable: true });
      await ada
        .post(`/worlds/${world}/types`)
        .send({ id: 'world.type.deity', label: 'Deity', fieldRefs: ['world.field.battle-map'] })
        .expect(201);

      const pelor = await ada
        .post('/entities')
        .send({ name: 'Pelor', types: ['world.type.deity'] })
        .expect(201);
      await ada
        .put(`/entities/${pelor.body.id}`)
        .send({
          document: { 'world.field.battle-map': paintedGrid },
          version: 1,
          tags: [],
          types: ['world.type.deity'],
        })
        .expect(200);

      const facets = await ada.get('/entities/facets').query({ worldId: world, type: 'world.type.deity' }).expect(200);
      expect(facets.body.fields).toEqual([]);
    });
  });
});
