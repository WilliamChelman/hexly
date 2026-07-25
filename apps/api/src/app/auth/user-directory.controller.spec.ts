import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DB, Db, createDb } from '../db/db';
import { AuthService } from './auth.service';
import { AuthModule } from './auth.module';
import { ConfigModule } from '../config/config.module';

describe('User directory', () => {
  let app: INestApplication;
  let db: Db;
  let adaId: string;
  let bobId: string;

  beforeEach(async () => {
    db = createDb(':memory:');
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, AuthModule],
    })
      .overrideProvider(DB)
      .useValue(db)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    // Listen for real: supertest otherwise churns an ephemeral port per request, and a reused loopback
    // 4-tuple still in TIME_WAIT is RST as `socket hang up`.
    await app.listen(0);

    adaId = await app.get(AuthService).seedUser('ada@hexly.test', 'correct horse', 'Ada');
    bobId = await app.get(AuthService).seedUser('bob@hexly.test', 'correct horse', 'Bob');
  });

  afterEach(async () => {
    await app.close();
  });

  async function signIn(email: string) {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/auth/login').send({ email, password: 'correct horse' }).expect(200);
    return agent;
  }

  it('lists every Instance user as id + displayName, without email', async () => {
    const ada = await signIn('ada@hexly.test');

    const res = await ada.get('/users/directory').expect(200);

    expect(res.body).toEqual(
      expect.arrayContaining([
        { id: adaId, displayName: 'Ada' },
        { id: bobId, displayName: 'Bob' },
      ]),
    );
    for (const u of res.body) expect(u).not.toHaveProperty('email');
  });

  it('rejects an unauthenticated request', async () => {
    await request(app.getHttpServer()).get('/users/directory').expect(401);
  });
});
