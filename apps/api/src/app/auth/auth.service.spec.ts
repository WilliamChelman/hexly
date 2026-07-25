import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { DB, Db, createDb } from '../db/db';
import { sessions } from '../db/schema';
import { AuthModule } from './auth.module';
import { AuthService } from './auth.service';

/** The credential-free session primitives an embedder needs; the Desktop App has no password (ADR-0070). */
describe('AuthService session primitives', () => {
  let app: INestApplication;
  let auth: AuthService;
  let db: Db;

  beforeEach(async () => {
    db = createDb(':memory:');
    const moduleRef = await Test.createTestingModule({ imports: [AuthModule] })
      .overrideProvider(DB)
      .useValue(db)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    auth = app.get(AuthService);
  });

  afterEach(async () => {
    await app.close();
  });

  it('finds a seeded user id by email, case- and whitespace-insensitively', async () => {
    const adaId = await auth.seedUser('Ada@Hexly.test', 'correct horse', 'Ada');

    expect(auth.findUserIdByEmail('  ada@hexly.TEST ')).toBe(adaId);
    expect(auth.findUserIdByEmail('bob@hexly.test')).toBeUndefined();
  });

  it('mints a session that authenticates, with no password involved', async () => {
    const adaId = await auth.seedUser('ada@hexly.test', 'correct horse', 'Ada');

    const token = auth.mintSession(adaId);

    await expect(auth.authenticate(token)).resolves.toMatchObject({ id: adaId, email: 'ada@hexly.test' });
  });

  it('honours an explicit expiry, so a caller can mint one the sweep never reaps', async () => {
    const adaId = await auth.seedUser('ada@hexly.test', 'correct horse', 'Ada');
    const farFuture = Date.now() + 1_000_000;

    const token = auth.mintSession(adaId, { expiresAt: farFuture });
    auth.purgeExpiredSessions();

    expect(db.select().from(sessions).where(eq(sessions.id, token)).get()?.expiresAt).toBe(farFuture);
    await expect(auth.authenticate(token)).resolves.not.toBeNull();
  });

  it('logoutAll ends every session a user holds and leaves other users alone', async () => {
    const adaId = await auth.seedUser('ada@hexly.test', 'correct horse', 'Ada');
    const bobId = await auth.seedUser('bob@hexly.test', 'battery staple', 'Bob');
    const stale = auth.mintSession(adaId);
    const alsoStale = auth.mintSession(adaId);
    const bobs = auth.mintSession(bobId);

    await auth.logoutAll(adaId);

    await expect(auth.authenticate(stale)).resolves.toBeNull();
    await expect(auth.authenticate(alsoStale)).resolves.toBeNull();
    await expect(auth.authenticate(bobs)).resolves.not.toBeNull();
  });
});
