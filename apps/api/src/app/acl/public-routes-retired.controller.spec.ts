import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication, RequestMethod, Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryModule, DiscoveryService } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { Agent } from 'supertest';
import { AppModule } from '../app.module';
import { ASSETS_DIR } from '../assets/assets.service';
import { AuthService } from '../auth/auth.service';
import { DB, Db, createDb } from '../db/db';

/**
 * The retired anonymous read path (ADR-0084, #435): with `open` and Open World carrying outsider reach,
 * the whole Public Link surface leaves the server — the successor to the deleted `public-links.controller.spec.ts`.
 * What that spec proved *resolved* this one proves *gone*: the `/public/**` GET routes and the mint/GET/revoke
 * `/link` routes no longer exist. The full {@link AppModule} boots so the graph sweep below is exhaustive over
 * every registered controller, and the resource whose public path is gone is proven still reachable through its
 * authenticated Detail route — so a 404 is the route's absence, never the fixture's.
 */
describe('Retired public read path (ADR-0084)', () => {
  let app: INestApplication;
  let db: Db;
  let assetsDir: string;

  beforeEach(async () => {
    db = createDb(':memory:'); // Isolated per-test (ADR-0002).
    assetsDir = mkdtempSync(join(tmpdir(), 'hexly-retired-public-assets-'));
    // Whole AppModule: the graph assertion below is exhaustive only if every registered controller is present.
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

    await app.get(AuthService).seedUser('ada@hexly.test', 'correct horse', 'Ada', { roles: ['create-worlds'] });
  });

  afterEach(async () => {
    await app.close();
    rmSync(assetsDir, { recursive: true, force: true });
  });

  async function signIn(email: string): Promise<Agent> {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/auth/login').send({ email, password: 'correct horse' }).expect(200);
    return agent;
  }

  /** The unauthenticated reader — the standing the Public Link served, now with no route to reach. */
  function anon() {
    return request(app.getHttpServer());
  }

  async function ownWorldAndEntity(ada: Agent): Promise<{ worldId: string; entityId: string }> {
    const worldId = (await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201)).body.id;
    const entityId = (
      await ada
        .post('/entities')
        .send({ name: 'Lady Mara', types: ['core.type.note'], worldId })
        .expect(201)
    ).body.id;
    return { worldId, entityId };
  }

  // The four shapes the deleted PublicLinksController exposed under `/public` (ADR-0037): a per-entity link,
  // a World link, and a World link's per-Entity / per-Compendium reads. Any token stands — a resolving one
  // would have been a 200 before, so a 404 on a well-formed token is the route's absence, not a bad token.
  const RETIRED_PUBLIC_ROUTES = [
    '/public/entities/some-token',
    '/public/worlds/some-token',
    '/public/worlds/some-token/entities/some-id',
    '/public/worlds/some-token/compendiums/some-id',
  ] as const;

  it('answers every retired /public GET as absent, for the anonymous reader it once served', async () => {
    for (const route of RETIRED_PUBLIC_ROUTES) {
      await anon().get(route).expect(404);
    }
  });

  it('routes no write verb under /public either — the whole surface is gone, not merely GET-only', async () => {
    await anon().post('/public/entities/some-token').send({}).expect(404);
    await anon().put('/public/entities/some-token').send({}).expect(404);
    await anon().patch('/public/entities/some-token').send({}).expect(404);
    await anon().delete('/public/entities/some-token').expect(404);
  });

  it('has retired the per-Entity link mint/read/revoke routes, though the Entity is reachable to its Owner', async () => {
    const ada = await signIn('ada@hexly.test');
    const { entityId } = await ownWorldAndEntity(ada);

    // The Entity itself is alive and reachable through its authenticated Detail route...
    expect((await ada.get(`/entities/${entityId}`).expect(200)).body.id).toBe(entityId);

    // ...so these 404s are the retired routes, not a missing Entity.
    await ada.post(`/entities/${entityId}/link`).send({}).expect(404);
    await ada.get(`/entities/${entityId}/link`).expect(404);
    await ada.delete(`/entities/${entityId}/link`).expect(404);
  });

  it('has retired the World link mint/revoke routes, though the World is reachable to its Owner', async () => {
    const ada = await signIn('ada@hexly.test');
    const { worldId } = await ownWorldAndEntity(ada);

    expect((await ada.get(`/worlds/${worldId}`).expect(200)).body.id).toBe(worldId);

    await ada.post(`/worlds/${worldId}/link`).send({}).expect(404);
    await ada.delete(`/worlds/${worldId}/link`).expect(404);
  });

  it('registers no controller route under /public, and no route named link, anywhere in the graph', () => {
    const routes = allRoutes(app.get(DiscoveryService));

    // The graph itself carries neither surface — the 404s above cannot be an incidental miss.
    expect(routes.filter((r) => r.includes('/public'))).toEqual([]);
    expect(routes.filter((r) => /\/link$/.test(r))).toEqual([]);
  });
});

/** Every registered HTTP route as `VERB /base/path`, read off the controller metadata (a class-level base
 * path prefixes each of its handlers). */
function allRoutes(discovery: DiscoveryService): string[] {
  const routes: string[] = [];
  for (const wrapper of discovery.getControllers()) {
    const controller = wrapper.metatype as Type<unknown> | undefined;
    if (!controller) continue;
    const base = Reflect.getMetadata(PATH_METADATA, controller) ?? '';
    for (const name of Object.getOwnPropertyNames(controller.prototype)) {
      const handler = (controller.prototype as Record<string, unknown>)[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      const routePath: string | undefined = Reflect.getMetadata(PATH_METADATA, handler);
      if (routePath === undefined) continue;
      const verb = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod];
      const segments = [base, routePath].filter((s) => s && s !== '/');
      routes.push(`${verb} /${segments.join('/')}`);
    }
  }
  return routes;
}
