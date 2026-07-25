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
    // Listen for real: supertest otherwise churns an ephemeral port per request, and a reused loopback
    // 4-tuple still in TIME_WAIT is RST as `socket hang up`.
    await app.listen(0);

    // Provision a member of the closed user set out-of-band (ADR-0004).
    await app.get(AuthService).seedUser('ada@hexly.test', 'correct horse', 'Ada', {
      roles: ['create-worlds'],
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('logs a seeded user in and reports them from /auth/me', async () => {
    const agent = request.agent(app.getHttpServer());

    await agent.post('/auth/login').send({ email: 'ada@hexly.test', password: 'correct horse' }).expect(200);

    const me = await agent.get('/auth/me').expect(200);

    expect(me.body).toEqual({
      id: expect.any(String),
      email: 'ada@hexly.test',
      displayName: 'Ada',
      // A fresh user has expressed no Preferences: an empty bag, so the client
      // falls back to its own detection (browser language, OS theme) (ADR-0038).
      preferences: {},
      // Seeded with the `create-worlds` role granted (ADR-0040, ADR-0047); the web
      // nav gates the "New World" affordance on it. No `manage-users` role.
      roles: ['create-worlds'],
      // Not the operator's tier — a separate flag, off for a plain member (ADR-0047).
      isSuperadmin: false,
    });
  });

  it('persists Preferences via PATCH and merges partial updates (ADR-0038)', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/auth/login').send({ email: 'ada@hexly.test', password: 'correct horse' }).expect(200);

    await agent.patch('/auth/me/preferences').send({ locale: 'fr' }).expect(200);
    // A later partial write must not clobber the earlier pref: PATCH merges.
    const patched = await agent
      .patch('/auth/me/preferences')
      .send({ theme: 'dark', formatLocale: 'en-GB' })
      .expect(200);
    expect(patched.body).toEqual({
      locale: 'fr',
      theme: 'dark',
      formatLocale: 'en-GB',
    });

    // The bag roams: it rides on the auth payload itself (ADR-0038).
    const me = await agent.get('/auth/me').expect(200);
    expect(me.body.preferences).toEqual({
      locale: 'fr',
      theme: 'dark',
      formatLocale: 'en-GB',
    });
  });

  it('clears a Preference back to "no choice" with an explicit null', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/auth/login').send({ email: 'ada@hexly.test', password: 'correct horse' }).expect(200);

    await agent.patch('/auth/me/preferences').send({ locale: 'fr', formatLocale: 'en-GB' }).expect(200);
    // "Same as language" = unset: null removes the key, it never stores null.
    const cleared = await agent.patch('/auth/me/preferences').send({ formatLocale: null }).expect(200);
    expect(cleared.body).toEqual({ locale: 'fr' });
  });

  it('rejects a Preferences patch that is not a valid bag', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/auth/login').send({ email: 'ada@hexly.test', password: 'correct horse' }).expect(200);

    // Unknown keys and out-of-vocabulary values must not reach storage.
    await agent.patch('/auth/me/preferences').send({ hacker: true }).expect(400);
    await agent.patch('/auth/me/preferences').send({ locale: 'de' }).expect(400);
  });

  it('refuses a Preferences write without a session', async () => {
    await request(app.getHttpServer()).patch('/auth/me/preferences').send({ locale: 'fr' }).expect(401);
  });

  it('lets a user rename themselves via PATCH /auth/me/profile', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/auth/login').send({ email: 'ada@hexly.test', password: 'correct horse' }).expect(200);

    const renamed = await agent.patch('/auth/me/profile').send({ displayName: 'Ada Lovelace' }).expect(200);
    expect(renamed.body.displayName).toBe('Ada Lovelace');

    const me = await agent.get('/auth/me').expect(200);
    expect(me.body.displayName).toBe('Ada Lovelace');
  });

  it('rejects a blank display name', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/auth/login').send({ email: 'ada@hexly.test', password: 'correct horse' }).expect(200);

    await agent.patch('/auth/me/profile').send({ displayName: '   ' }).expect(400);
    // Email is read-only (ADR-0038): it is not part of the profile contract.
    await agent.patch('/auth/me/profile').send({ displayName: 'Ada', email: 'new@hexly.test' }).expect(400);
  });

  it('changes the password after verifying the current one', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/auth/login').send({ email: 'ada@hexly.test', password: 'correct horse' }).expect(200);

    await agent
      .post('/auth/me/password')
      .send({ currentPassword: 'correct horse', newPassword: 'battery staple' })
      .expect(200);

    // The old password is dead, the new one opens a session.
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'ada@hexly.test', password: 'correct horse' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'ada@hexly.test', password: 'battery staple' })
      .expect(200);
  });

  it('refuses a password change when the current password is wrong', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/auth/login').send({ email: 'ada@hexly.test', password: 'correct horse' }).expect(200);

    await agent
      .post('/auth/me/password')
      .send({ currentPassword: 'not it', newPassword: 'battery staple' })
      .expect(401);

    // Unchanged: the original password still logs in.
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'ada@hexly.test', password: 'correct horse' })
      .expect(200);
  });

  it('refuses a too-short new password', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/auth/login').send({ email: 'ada@hexly.test', password: 'correct horse' }).expect(200);

    await agent.post('/auth/me/password').send({ currentPassword: 'correct horse', newPassword: 'short' }).expect(400);
  });

  it('rejects a wrong password and issues no session', async () => {
    const agent = request.agent(app.getHttpServer());

    await agent.post('/auth/login').send({ email: 'ada@hexly.test', password: 'wrong' }).expect(401);

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

    await agent.post('/auth/login').send({ email: 'ada@hexly.test', password: 'correct horse' }).expect(200);
    await agent.get('/auth/me').expect(200);

    await agent.post('/auth/logout').expect(200);

    await agent.get('/auth/me').expect(401);
  });

  it('stores the password as an argon2 hash, never the plaintext', () => {
    const db = app.get<Db>(DB);
    const row = db.select().from(users).where(eq(users.email, 'ada@hexly.test')).get();

    expect(row?.passwordHash).not.toContain('correct horse');
    expect(row?.passwordHash.startsWith('$argon2')).toBe(true);
  });

  it('rejects a malformed login body with 400, not a server error', async () => {
    await request(app.getHttpServer()).post('/auth/login').send({ email: 'ada@hexly.test' }).expect(400);
  });

  it('purges expired sessions on login but leaves valid ones', async () => {
    const db = app.get<Db>(DB);
    const ada = db.select().from(users).where(eq(users.email, 'ada@hexly.test')).get();

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
