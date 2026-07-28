import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { CompendiumSummary, EntityFacets, EntitySummary, FacetCount } from '@hexly/domain';
import { DS_MONSTER, DS_STAT_BLOCK_KEY } from '@hexly/plugin-draw-steel';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { ConfigModule } from '../config/config.module';
import { DB, Db, createDb } from '../db/db';
import { EntitiesModule } from '../entities/entities.module';
import { EntitiesService } from '../entities/entities.service';
import { CompendiumWrites } from './compendium-writes';
import { WorldsModule } from './worlds.module';

/**
 * The **Compendium browse** (#401, ADR-0079): the Entity Browser preset that unions every installed
 * pack. Asserted at the HTTP seam, since what is interesting here is what an ordinary signed-in caller
 * can see — the browse exists to make reference material reachable, and reachability is the one thing a
 * service-shaped test would not prove.
 *
 * Packs are seeded through `CompendiumWrites` + the import insert rather than by running an Importer:
 * this is about the read, and two packs are needed to have a Compendium facet worth narrowing. The real
 * Importer's end of it lives in `draw-steel-monsters-import.controller.spec.ts`.
 */
describe('The Compendium browse', () => {
  let app: INestApplication;
  let db: Db;

  /** The two installed packs, and the World Ada authors in. */
  let monsters: string;
  let treasures: string;
  let world: string;

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
    await app.listen(0);

    const adaId = await seed('ada@hexly.test', 'Ada');
    const ada = await signIn('ada@hexly.test');
    world = (await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201)).body.id;

    monsters = install('draw-steel.importer.monsters', 'Draw Steel: Monsters', '1.4.0');
    treasures = install('draw-steel.importer.treasures', 'Draw Steel: Treasures', '0.9.0');
    // The install leaves the running user the entry's `owner` grant, exactly as the reconcile does — so
    // "everyone can read this" is proved against the accident rather than around it.
    entry(adaId, monsters, 'Goblin Warrior', { role: 'harrier', organization: 'horde', level: 1 });
    entry(adaId, monsters, 'Ajax the Invincible', { role: 'brute', organization: 'solo', level: 11 });
    entry(adaId, treasures, 'Sword of Dawn', { role: 'support', organization: 'elite', level: 4 });
  });

  afterEach(async () => {
    await app.close();
  });

  it('lists every installed pack, for any signed-in caller', async () => {
    // Bob authors nowhere, runs nothing, and is a member of no World — Instance-wide with no members
    // means being signed in *is* the standing (ADR-0078).
    await seed('bob@hexly.test', 'Bob');
    const bob = await signIn('bob@hexly.test');

    const packs = (await bob.get('/compendiums').expect(200)).body as CompendiumSummary[];
    expect(packs.map((pack) => pack.name)).toEqual(['Draw Steel: Monsters', 'Draw Steel: Treasures']);
    // Which revision this is, and the terms the content is published under — the row #402 renders.
    expect(packs[0]).toMatchObject({
      id: monsters,
      importer: 'draw-steel.importer.monsters',
      rev: '1.4.0',
      attribution: { publisher: 'MCDM', license: 'Draw Steel Creator License' },
    });
    // A pack that recorded no terms carries no empty scaffold for a page to render (#402).
    expect(packs[1].attribution).toEqual({});
  });

  it('unions every installed pack, and the Compendium facet narrows to one', async () => {
    await seed('bob@hexly.test', 'Bob');
    const bob = await signIn('bob@hexly.test');

    // The browse names its Containers explicitly — the read is *about* compendium content, so it says
    // which Containers rather than riding the single-Container scoping a World read uses.
    const scope = `containerId=${monsters}&containerId=${treasures}`;
    expect(await names(bob, scope)).toEqual(['Ajax the Invincible', 'Goblin Warrior', 'Sword of Dawn']);

    // The Compendium facet: one value per pack, named and counted.
    const facets = await facetsOf(bob, scope);
    expect(facets.compendium).toEqual([
      { value: monsters, count: 2, label: 'Draw Steel: Monsters' },
      { value: treasures, count: 1, label: 'Draw Steel: Treasures' },
    ]);

    // Narrowing to one pack narrows the list...
    expect(await names(bob, `${scope}&compendium=${monsters}`)).toEqual(['Ajax the Invincible', 'Goblin Warrior']);
    // ...and every sibling category counts under it...
    const narrowed = await facetsOf(bob, `${scope}&compendium=${monsters}`);
    expect(valuesOf(narrowed, 'role')).toEqual(['brute', 'harrier']);
    // ...while the Compendium facet itself still counts over the whole scope, so the pack just
    // deselected is still there to click back on (drill-down, exactly as Type and Tag do).
    expect(narrowed.compendium?.map((v) => v.value)).toEqual([monsters, treasures]);
  });

  it("offers the packs' own dimensions as Facets, not just Type and Tag", async () => {
    const ada = await signIn('ada@hexly.test');
    const facets = await facetsOf(ada, `containerId=${monsters}&containerId=${treasures}`);

    // Role, organization and level ride the pack's stat block into the Facet rail (ADR-0055, #244), so a
    // monster is findable by what it is rather than by remembering its name.
    expect(facets.fields.map((f) => f.key)).toEqual(['role', 'organization', 'level']);
    expect(valuesOf(facets, 'organization')).toEqual(['elite', 'horde', 'solo']);
    // And they filter: one brute across three packs' worth of entries.
    expect(await names(ada, `containerId=${monsters}&containerId=${treasures}&field=role:eq:brute`)).toEqual([
      'Ajax the Invincible',
    ]);
  });

  it('reads across packs by full text, and is not fooled by a Container it was not given', async () => {
    const ada = await signIn('ada@hexly.test');
    // Search behaves as it does anywhere else — the browse is the Entity Browser, preset.
    expect(await names(ada, `containerId=${monsters}&containerId=${treasures}&q=sword`)).toEqual(['Sword of Dawn']);
    // The facet selection narrows *within* the scope and can never widen it: naming a Container the
    // browse was not scoped to reaches nothing, rather than escaping into it.
    expect(await names(ada, `containerId=${monsters}&compendium=${treasures}`)).toEqual([]);
  });

  it('opens an entry at its own URL, read-only, for a caller who owns nothing', async () => {
    await seed('bob@hexly.test', 'Bob');
    const bob = await signIn('bob@hexly.test');
    const goblin = await entityByName(bob, monsters, 'Goblin Warrior');

    // A real, shareable URL: the entry loads directly by id, for someone who never ran the import.
    const detail = (await bob.get(`/entities/${goblin.id}`).expect(200)).body;
    expect(detail).toMatchObject({ name: 'Goblin Warrior', worldId: monsters, sealed: true });
    // Read and nothing else — so no client renders an edit, delete, visibility or sharing affordance for
    // something the API will refuse to write.
    expect(detail.rights).toEqual(['read']);
    expect(goblin.summary.rights).toEqual(['read']);
    // ...and the refusal it is honest about: reachable now, so the seal answers rather than a 404.
    await bob.put(`/entities/${goblin.id}`).send({ document: {}, version: 1, tags: [] }).expect(403);
    await bob.delete(`/entities/${goblin.id}`).expect(403);
  });

  it('leaves the Entity Browser showing only the World’s own Entities', async () => {
    const ada = await signIn('ada@hexly.test');
    // Carrying the pack's own Type, so the partition is shown to be location and nothing else.
    await ada
      .post('/entities')
      .send({ name: 'Grix the Turncoat', types: [DS_MONSTER], worldId: world })
      .expect(201);

    expect(await names(ada, `worldId=${world}`)).toEqual(['Grix the Turncoat']);
    // Making the shelf readable Instance-wide must not make it *listable* in a World that isn't its own.
    await seed('bob@hexly.test', 'Bob');
    expect(await names(await signIn('bob@hexly.test'), `worldId=${world}`)).toEqual([]);
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

  /** Install a pack — the Compendium Container the reconcile would land into. */
  function install(importer: string, name: string, rev: string): string {
    // Only the first pack states terms, so the "no attribution recorded" case is covered too.
    const attribution =
      importer === 'draw-steel.importer.monsters'
        ? { publisher: 'MCDM', license: 'Draw Steel Creator License', notice: 'Draw Steel © MCDM Productions.' }
        : undefined;
    return app.get(CompendiumWrites).install(importer, { name, attribution }, rev);
  }

  /** One entry on the shelf, landed the way a reconcile lands one: the system insert, with an owner grant. */
  function entry(ownerId: string, containerId: string, name: string, block: Record<string, unknown>): void {
    app.get(EntitiesService).importEntity({
      ownerId,
      containerId,
      name,
      types: [DS_MONSTER],
      tags: [],
      document: { [DS_STAT_BLOCK_KEY]: block },
    });
  }

  async function items(agent: Agent, query: string): Promise<EntitySummary[]> {
    return (await agent.get(`/entities?${query}&rights=1`).expect(200)).body.items;
  }

  /**
   * The result set by name, sorted here rather than as returned: the browse's own order is `updatedAt`
   * descending, and a fixture that seeds every entry within one millisecond cannot express it. What
   * these tests are about is *which* entries a read reaches.
   */
  async function names(agent: Agent, query: string): Promise<string[]> {
    return (await items(agent, query)).map((e) => e.name).sort();
  }

  async function facetsOf(agent: Agent, query: string): Promise<EntityFacets> {
    return (await agent.get(`/entities/facets?${query}`).expect(200)).body;
  }

  /** One Field facet's live values, by key — the rail's own reading of a harvested dimension. */
  function valuesOf(facets: EntityFacets, key: string): string[] {
    return (facets.fields.find((f) => f.key === key)?.values ?? []).map((v: FacetCount) => v.value);
  }

  async function entityByName(agent: Agent, containerId: string, name: string) {
    const summary = (await items(agent, `containerId=${containerId}`)).find((e) => e.name === name);
    expect(summary, `no Entity named ${name}`).toBeDefined();
    return { id: (summary as EntitySummary).id, summary: summary as EntitySummary };
  }
});
