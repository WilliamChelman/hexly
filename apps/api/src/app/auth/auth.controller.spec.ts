import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { DB, Db, createDb } from '../db/db';
import { sessions, users } from '../db/schema';
import { AuthModule } from './auth.module';
import { AuthService } from './auth.service';

describe('Auth endpoints', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule],
    })
      // A throwaway in-memory database per test — real Drizzle, real schema,
      // no shared state between tests (ADR-0002).
      .overrideProvider(DB)
      .useValue(createDb(':memory:'))
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    // Provision a member of the closed user set out-of-band (ADR-0004).
    await app
      .get(AuthService)
      .seedUser('ada@hexly.test', 'correct horse', 'Ada');
  });

  afterEach(async () => {
    await app.close();
  });

  it('logs a seeded user in and reports them from /auth/me', async () => {
    const agent = request.agent(app.getHttpServer());

    await agent
      .post('/auth/login')
      .send({ email: 'ada@hexly.test', password: 'correct horse' })
      .expect(200);

    const me = await agent.get('/auth/me').expect(200);

    expect(me.body).toEqual({
      id: expect.any(String),
      email: 'ada@hexly.test',
      displayName: 'Ada',
    });
  });

  it('rejects a wrong password and issues no session', async () => {
    const agent = request.agent(app.getHttpServer());

    await agent
      .post('/auth/login')
      .send({ email: 'ada@hexly.test', password: 'wrong' })
      .expect(401);

    // No cookie was set, so the would-be session does not authenticate.
    await agent.get('/auth/me').expect(401);
  });

  it('rejects an unknown email without revealing it is unknown', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'nobody@hexly.test', password: 'correct horse' })
      .expect(401);
  });

  it('refuses /auth/me when no session cookie is presented', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('ends the session on logout so /auth/me stops authenticating', async () => {
    const agent = request.agent(app.getHttpServer());

    await agent
      .post('/auth/login')
      .send({ email: 'ada@hexly.test', password: 'correct horse' })
      .expect(200);
    await agent.get('/auth/me').expect(200);

    await agent.post('/auth/logout').expect(200);

    await agent.get('/auth/me').expect(401);
  });

  it('stores the password as an argon2 hash, never the plaintext', () => {
    const db = app.get<Db>(DB);
    const row = db
      .select()
      .from(users)
      .where(eq(users.email, 'ada@hexly.test'))
      .get();

    expect(row?.passwordHash).not.toContain('correct horse');
    expect(row?.passwordHash.startsWith('$argon2')).toBe(true);
  });

  it('rejects a malformed login body with 400, not a server error', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'ada@hexly.test' })
      .expect(400);
  });

  it('purges expired sessions on login but leaves valid ones', async () => {
    const db = app.get<Db>(DB);
    const ada = db
      .select()
      .from(users)
      .where(eq(users.email, 'ada@hexly.test'))
      .get();

    db.insert(sessions)
      .values([
        { id: 'expired', userId: ada!.id, createdAt: 0, expiresAt: 1 },
        {
          id: 'still-valid',
          userId: ada!.id,
          createdAt: Date.now(),
          expiresAt: Date.now() + 1_000_000,
        },
      ])
      .run();

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'ada@hexly.test', password: 'correct horse' })
      .expect(200);

    const survivors = db
      .select()
      .from(sessions)
      .all()
      .map((s) => s.id);
    expect(survivors).not.toContain('expired');
    expect(survivors).toContain('still-valid');
  });

  it('exposes no public signup endpoint (ADR-0004)', async () => {
    const server = app.getHttpServer();

    await request(server).post('/auth/register').expect(404);
    await request(server).post('/auth/signup').expect(404);
    await request(server).post('/auth/users').expect(404);
  });
});
