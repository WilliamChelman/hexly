import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { CompendiumSummary } from '@hexly/domain';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { ConfigModule } from '../config/config.module';
import { DB, Db, createDb } from '../db/db';
import { EntitiesModule } from '../entities/entities.module';
import { CompendiumWrites } from './compendium-writes';
import { WorldsModule } from './worlds.module';

/**
 * The read behind the **Compendium page** (ADR-0061, #402), asserted at the HTTP seam: both facts that
 * matter are about the wire rather than the service — who gets an answer, and what shape absent terms
 * arrive in.
 */
describe('The Compendium page read', () => {
  let app: INestApplication;
  let db: Db;

  /** The pack that states its terms, the pack that states none, and a World to prove the read is typed. */
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

    await seed('ada@hexly.test', 'Ada');
    const ada = await signIn('ada@hexly.test');
    world = (await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201)).body.id;

    monsters = app.get(CompendiumWrites).install(
      'draw-steel.importer.monsters',
      {
        name: 'Draw Steel: Monsters',
        attribution: {
          publisher: 'MCDM Productions',
          license: 'Draw Steel Creator License',
          notice: 'Draw Steel © 2025 MCDM Productions, LLC.',
        },
      },
      '1.4.0',
    );
    treasures = app.get(CompendiumWrites).install('draw-steel.importer.treasures', { name: 'Homebrew' }, '0.9.0');
  });

  afterEach(async () => {
    await app.close();
  });

  it('states the terms to any signed-in caller', async () => {
    // Bob authors nowhere, ran no import and is a member of no World — being on this Instance *is* the
    // standing a Compendium asks for (ADR-0078).
    await seed('bob@hexly.test', 'Bob');
    const bob = await signIn('bob@hexly.test');

    const pack = (await bob.get(`/compendiums/${monsters}`).expect(200)).body as CompendiumSummary;
    expect(pack).toMatchObject({
      id: monsters,
      name: 'Draw Steel: Monsters',
      importer: 'draw-steel.importer.monsters',
      // The revision the terms attach to; the pin only moves in a code change (ADR-0061).
      rev: '1.4.0',
      attribution: {
        publisher: 'MCDM Productions',
        license: 'Draw Steel Creator License',
        notice: 'Draw Steel © 2025 MCDM Productions, LLC.',
      },
    });
  });

  it('sends nothing at all for a Compendium that recorded no terms', async () => {
    const ada = await signIn('ada@hexly.test');

    const pack = (await ada.get(`/compendiums/${treasures}`).expect(200)).body as CompendiumSummary;
    // Absent, not null: the page renders a section per term it was given, so "no terms" has to arrive as
    // no terms if it is to render no empty scaffold.
    expect(Object.keys(pack.attribution)).toEqual([]);
    expect(pack).toMatchObject({ name: 'Homebrew', rev: '0.9.0' });
  });

  it('is not a way to read a World', async () => {
    const ada = await signIn('ada@hexly.test');

    // Driven off the `compendiums` satellite, which *is* the "this is a Compendium" discriminator
    // (ADR-0078) — so a World's id is simply not found here, and no Collaboration rule is consulted.
    await ada.get(`/compendiums/${world}`).expect(404);
    await ada.get('/compendiums/00000000-0000-4000-8000-000000000000').expect(404);
  });

  it('is closed to a caller who is not signed in at all', async () => {
    // ADR-0034's possession-is-the-token is content-addressed bytes on a static route — "the hash *is*
    // the access token" — and nothing extends it to an API read, so a pack's Container id is an
    // identifier here rather than a credential.
    await request(app.getHttpServer()).get(`/compendiums/${monsters}`).expect(401);
    // The shelf itself stays signed-in too, so what an Instance has installed is never there to enumerate.
    await request(app.getHttpServer()).get('/compendiums').expect(401);
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
});
