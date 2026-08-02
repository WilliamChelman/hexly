import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication, RequestMethod, Type } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryModule, DiscoveryService } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { Agent } from 'supertest';
import { AppModule } from '../app.module';
import { ASSETS_DIR, AssetsService } from '../assets/assets.service';
import { AuthService } from '../auth/auth.service';
import { pinDeployment } from '../config';
import { DB, Db, createDb } from '../db/db';
import { EntitiesService } from '../entities/entities.service';
import { CompendiumWrites } from '../worlds/compendium-writes';
import { WorldWrites } from '../worlds/world-writes';
import { WorldsService } from '../worlds/worlds.service';
import { CollaborationGuard } from './collaboration.guard';
import { AclSetResult } from './owner-set';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/**
 * Every route the Collaboration layer owns (ADR-0071), as `VERB /pattern`: the sweeps below drive it and
 * {@link discoverGatedRoutes} must reproduce it exactly.
 */
const COLLABORATION_ROUTES = [
  'GET /entities/:id/owners',
  'POST /entities/:id/owners',
  'DELETE /entities/:id/owners/:userId',
  'GET /entities/:id/grants',
  'POST /entities/:id/grants',
  'DELETE /entities/:id/grants/:userId',
  'GET /entities/:id/link',
  'POST /entities/:id/link',
  'DELETE /entities/:id/link',
  'GET /worlds/:id/owners',
  'POST /worlds/:id/owners',
  'DELETE /worlds/:id/owners/:userId',
  'GET /worlds/:id/members',
  'POST /worlds/:id/members',
  'PATCH /worlds/:id/members/:userId',
  'DELETE /worlds/:id/members/:userId',
  'GET /worlds/:id/link',
  'POST /worlds/:id/link',
  'DELETE /worlds/:id/link',
  'GET /public/entities/:token',
  'GET /public/worlds/:token',
  'GET /public/worlds/:token/entities/:id',
  'GET /public/worlds/:token/compendiums/:id',
  'GET /users',
  'POST /users',
  'POST /users/:id/password',
  'PATCH /users/:id/roles',
  'PATCH /users/:id/superadmin',
  'DELETE /users/:id',
  'PATCH /users/:id/disabled',
  'GET /users/directory',
] as const;

/** The Instance the sweeps run against: what an operator who *had* Collaboration left behind. */
interface Fixtures {
  /** The signed-in caller: Superadmin and sole Owner of both fixtures, so no role check can be the refusal. */
  readonly agent: Agent;
  readonly operator: string;
  readonly other: string;
  readonly world: string;
  readonly entity: string;
  /** An installed pack the World Mounts, so the public Compendium-page read has terms to answer with. */
  readonly pack: string;
  readonly worldToken: string;
  readonly entityToken: string;
}

/**
 * Substitutes the fixture that makes the route reachable, so a 404 can only be the gate. `:userId` is the
 * caller on the ownership routes, where removal is refused as `last-owner` (409) rather than 404.
 */
function concretePath(pattern: string, f: Fixtures): string {
  const segments = pattern.split('/');
  return segments
    .map((segment, i) => {
      if (!segment.startsWith(':')) return segment;
      if (segment === ':userId') return segments[i - 1] === 'owners' ? f.operator : f.other;
      if (segment === ':token') return segments[i - 1] === 'entities' ? f.entityToken : f.worldToken;
      if (segments[i - 1] === 'compendiums') return f.pack;
      // Under the `/public` reader, `:id` is an Entity.
      switch (segments[1]) {
        case 'entities':
        case 'public':
          return f.entity;
        case 'worlds':
          return f.world;
        case 'users':
          return f.other;
      }
      throw new Error(`no fixture for ${pattern}`);
    })
    .join('/');
}

/** Empty body on purpose: with the gate open a write route answers 400, a status only a reached handler gives. */
function call(f: Fixtures, route: string) {
  const [verb, pattern] = route.split(' ');
  const path = concretePath(pattern, f);
  switch (verb) {
    case 'GET':
      return f.agent.get(path);
    case 'POST':
      return f.agent.post(path).send({});
    case 'PATCH':
      return f.agent.patch(path).send({});
    case 'DELETE':
      return f.agent.delete(path);
    default:
      throw new Error(`unhandled verb ${verb}`);
  }
}

/** Every route carrying a {@link CollaborationGuard}; a class-level guard covers all of its handlers. */
function discoverGatedRoutes(discovery: DiscoveryService): string[] {
  const gated: string[] = [];
  for (const wrapper of discovery.getControllers()) {
    const controller = wrapper.metatype as Type<unknown> | undefined;
    if (!controller) continue;
    const base = Reflect.getMetadata(PATH_METADATA, controller) ?? '';
    const classGated = guardsOn(controller).includes(CollaborationGuard);
    for (const name of Object.getOwnPropertyNames(controller.prototype)) {
      const handler = (controller.prototype as Record<string, unknown>)[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      const routePath: string | undefined = Reflect.getMetadata(PATH_METADATA, handler);
      if (routePath === undefined) continue;
      if (!classGated && !guardsOn(handler).includes(CollaborationGuard)) continue;
      const verb = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod];
      const segments = [base, routePath].filter((s) => s && s !== '/');
      gated.push(`${verb} /${segments.join('/')}`);
    }
  }
  return gated;
}

function guardsOn(target: object): unknown[] {
  return Reflect.getMetadata(GUARDS_METADATA, target) ?? [];
}

function unwrap<T>(result: AclSetResult<T>): T {
  if (result.status !== 'ok') throw new Error(`fixture setup failed: ${result.status}`);
  return result.value;
}

/**
 * The Collaboration gate (ADR-0071): with `features.collaboration` off the sharing and user-management
 * routes are absent, not merely hidden.
 */
describe('Collaboration gate', () => {
  let app: INestApplication;
  let db: Db;
  let assetsDir: string;

  async function boot(collaboration: boolean): Promise<void> {
    db = createDb(':memory:'); // Isolated per-test (ADR-0002).
    assetsDir = mkdtempSync(join(tmpdir(), 'hexly-collab-assets-'));
    // The entry-point pin (ADR-0071) rather than a fabricated HEXLY_CONFIG, so ConfigModule still
    // composes the rest of the config for real.
    pinDeployment({ collaboration });
    // Whole AppModule: the coverage assertion below is exhaustive only if every registered controller
    // is in the graph.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule, DiscoveryModule] })
      .overrideProvider(DB)
      .useValue(db)
      .overrideProvider(ASSETS_DIR)
      .useValue(assetsDir)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    // Listen for real: supertest otherwise churns an ephemeral port per request, and a reused loopback
    // 4-tuple still in TIME_WAIT is RST as `socket hang up`.
    await app.listen(0);
  }

  afterEach(async () => {
    pinDeployment({});
    await app.close();
    rmSync(assetsDir, { recursive: true, force: true });
  });

  /**
   * An Instance that had Collaboration and turned it off, so every swept route is genuinely reachable and
   * no 404 is the fixture's. Links and membership are minted through the services because their HTTP
   * routes are the ones under test.
   */
  async function fixtures(): Promise<Fixtures> {
    const auth = app.get(AuthService);
    const operator = await auth.seedUser('root@hexly.test', 'correct horse', 'Root', {
      isSuperadmin: true,
      roles: ['create-worlds'],
    });
    const other = await auth.seedUser('other@hexly.test', 'correct horse', 'Other');

    const agent = request.agent(app.getHttpServer());
    await agent.post('/auth/login').send({ email: 'root@hexly.test', password: 'correct horse' }).expect(200);

    const world = (await agent.post('/worlds').send({ name: 'Aldermoor' }).expect(201)).body.id;
    const entity = (
      await agent
        .post('/entities')
        .send({ name: 'Lady Mara', types: ['core.type.note'], worldId: world })
        .expect(201)
    ).body.id;
    // `shared`, so the World link's reader can reach it (ADR-0037).
    await agent.patch(`/entities/${entity}`).send({ visibility: 'shared' }).expect(200);

    const worlds = app.get(WorldsService);
    unwrap(worlds.addMember(operator, world, other, 'contributor'));
    unwrap(app.get(EntitiesService).addGrant(operator, entity, other, 'viewer'));
    const worldToken = unwrap(worlds.mintLink(operator, world)).token;
    const entityToken = unwrap(app.get(EntitiesService).mintLink(operator, entity)).token;
    // Installed and Mounted, so a pack's terms are reachable through the World link the way ADR-0080
    // says they must be — the only standing the public Compendium read has.
    const pack = app
      .get(CompendiumWrites)
      .install('draw-steel.importer.monsters', { name: 'Draw Steel: Monsters' }, '1.4.0');
    app.get(WorldWrites).mount(world, pack);

    return { agent, operator, other, world, entity, pack, worldToken, entityToken };
  }

  describe('with Collaboration off', () => {
    let f: Fixtures;

    beforeEach(async () => {
      await boot(false);
      f = await fixtures();
    });

    it.each(COLLABORATION_ROUTES)('404s %s', async (route) => {
      await call(f, route).expect(404);
    });

    it('gates exactly the routes this spec sweeps, and no others', () => {
      expect(discoverGatedRoutes(app.get(DiscoveryService)).sort()).toEqual([...COLLABORATION_ROUTES].sort());
    });

    it('answers the class-gated surfaces as absent before it answers them as unauthorized', async () => {
      // The guard is listed first on those controllers, so an anonymous caller reads them as missing
      // rather than unauthorized.
      const anonymous = request(app.getHttpServer());
      await anonymous.get('/users').expect(404);
      await anonymous.get('/users/directory').expect(404);
      await anonymous.get(`/public/worlds/${f.worldToken}`).expect(404);
    });

    it('leaves the login endpoint alone — it is auth, not Collaboration', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'root@hexly.test', password: 'correct horse' })
        .expect(200);
    });

    it('leaves both Reindex endpoints alone — ADR-0037 repair, and here the user is the operator', async () => {
      await f.agent.post('/admin/reindex').expect(202);
      await f.agent.get('/admin/reindex').expect(200);
    });

    it('leaves the unauthenticated client config channel alone, and says Collaboration is off', async () => {
      const res = await request(app.getHttpServer()).get('/config').expect(200);
      expect(res.body.collaboration).toBe(false);
    });

    it('leaves the Asset bytes route alone — the content hash is its access control', async () => {
      const { url } = app.get(AssetsService).store(f.world, 'Portrait.png', PNG);

      const res = await request(app.getHttpServer()).get(url).expect(200);
      expect(new Uint8Array(res.body)).toEqual(PNG);
    });

    it('leaves the live-follow bus alone — it stays for multi-window (ADR-0071)', async () => {
      // A malformed interest set: the 400 is the handler's own, so the route was reached.
      await f.agent.put('/events/no-such-connection/interest').send({}).expect(400);
    });
  });

  describe('with Collaboration on (the default)', () => {
    let f: Fixtures;

    beforeEach(async () => {
      await boot(true);
      f = await fixtures();
    });

    // Only the gate matters here; each surface's own spec pins down what these routes answer.
    it.each(COLLABORATION_ROUTES)('opens %s', async (route) => {
      const res = await call(f, route);
      expect(res.status).not.toBe(404);
    });
  });
});
