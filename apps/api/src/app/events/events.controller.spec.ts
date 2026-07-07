import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DB, Db, createDb } from '../db/db';
import { entityGrants } from '../db/schema';
import { AuthService } from '../auth/auth.service';
import { AuthModule } from '../auth/auth.module';
import { ConfigModule } from '../config/config.module';
import { EntitiesModule } from '../entities/entities.module';
import { WorldsModule } from '../worlds/worlds.module';
import { WorldsService } from '../worlds/worlds.service';
import { EventsModule } from './events.module';

/**
 * Seam A (ADR-0044, #173): the SSE nudge bus over the wire. These tests open a real
 * `text/event-stream` and read pushed frames — the net-new bit is {@link openSse}, a frame
 * reader that composes the existing supertest cookie login (supertest itself buffers to
 * end-of-response, which an SSE stream never reaches).
 */
describe('Events (SSE nudge bus) endpoints', () => {
  let app: INestApplication;
  let db: Db;
  let baseUrl: string;

  beforeEach(async () => {
    db = createDb(':memory:'); // Isolated per-test (ADR-0002).
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, AuthModule, EventsModule, EntitiesModule, WorldsModule],
    })
      .overrideProvider(DB)
      .useValue(db)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    // A real listening socket: SSE needs a live stream, not the in-memory handler
    // supertest drives for one-shot requests.
    await app.listen(0);
    baseUrl = await app.getUrl();

    const adaId = await app
      .get(AuthService)
      .seedUser('ada@hexly.test', 'correct horse', 'Ada', { canCreateWorlds: true });
    // Entity creation needs a World (ADR-0024); mint one for Ada.
    app.get(WorldsService).mintWorld(adaId, 'Aldermoor');
  });

  afterEach(async () => {
    await app.close();
  });

  /** Log in via supertest (reusing the cookie agent), returning the raw session cookie header. */
  async function sessionCookie(email: string, password: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    const setCookie = res.headers['set-cookie'] as unknown as string[];
    return setCookie.map((c) => c.split(';')[0]).join('; ');
  }

  /**
   * Open the SSE stream and read parsed frames one at a time. `next()` resolves the next
   * complete `event:/data:` frame; `close()` cancels the reader. Frames are `{ event, data }`
   * with `data` JSON-parsed.
   */
  async function openSse(cookie: string) {
    const res = await fetch(baseUrl + '/events', { headers: { cookie } });
    if (!res.body) throw new Error('no SSE body');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    return {
      contentType: res.headers.get('content-type') ?? '',
      async next(): Promise<{ event: string; data: unknown }> {
        // A frame ends at a blank line (\n\n). Accumulate chunks until one lands.
        for (;;) {
          const idx = buffer.indexOf('\n\n');
          if (idx !== -1) {
            const raw = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            let event = 'message';
            const dataLines: string[] = [];
            for (const line of raw.split('\n')) {
              if (line.startsWith('event:')) event = line.slice(6).trim();
              else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
            }
            const joined = dataLines.join('\n');
            return { event, data: joined ? JSON.parse(joined) : undefined };
          }
          const { value, done } = await reader.read();
          if (done) throw new Error('SSE stream ended before a frame');
          buffer += decoder.decode(value, { stream: true });
        }
      },
      async close() {
        await reader.cancel();
      },
    };
  }

  it('returns text/event-stream whose first frame mints a fresh, unguessable connectionId', async () => {
    const cookie = await sessionCookie('ada@hexly.test', 'correct horse');
    const sse = await openSse(cookie);

    expect(sse.contentType).toContain('text/event-stream');
    const first = await sse.next();
    expect(first.event).toBe('ready');
    expect(first.data).toEqual({ connectionId: expect.any(String) });
    // Unguessable: a UUID-length token, not a guessable counter.
    expect((first.data as { connectionId: string }).connectionId.length).toBeGreaterThanOrEqual(
      16,
    );

    await sse.close();
  });

  it('rejects an unauthenticated stream open with 401', async () => {
    const res = await fetch(baseUrl + '/events');
    expect(res.status).toBe(401);
    // Drain so the socket closes cleanly.
    await res.body?.cancel();
  });

  /** Open a stream and return its connectionId (reading the `ready` frame). */
  async function connect(cookie: string) {
    const sse = await openSse(cookie);
    const ready = (await sse.next()).data as { connectionId: string };
    return { sse, connectionId: ready.connectionId };
  }

  it('replaces the whole interest set idempotently for the owning principal', async () => {
    const cookie = await sessionCookie('ada@hexly.test', 'correct horse');
    const { sse, connectionId } = await connect(cookie);
    const refs = { refs: [{ kind: 'entity', id: 'e1' }] };

    // Idempotent: the same PUT twice both succeed and leave the same set.
    await request(app.getHttpServer())
      .put(`/events/${connectionId}/interest`)
      .set('Cookie', cookie)
      .send(refs)
      .expect(204);
    await request(app.getHttpServer())
      .put(`/events/${connectionId}/interest`)
      .set('Cookie', cookie)
      .send(refs)
      .expect(204);

    await sse.close();
  });

  it('rejects (does not apply) an interest PUT from a principal that does not own the connection', async () => {
    await app
      .get(AuthService)
      .seedUser('bob@hexly.test', 'hunter2 stationery', 'Bob');
    const adaCookie = await sessionCookie('ada@hexly.test', 'correct horse');
    const bobCookie = await sessionCookie('bob@hexly.test', 'hunter2 stationery');
    const { sse, connectionId } = await connect(adaCookie);

    // Bob knows (guesses) Ada's connectionId but is a different principal → 403, not applied.
    await request(app.getHttpServer())
      .put(`/events/${connectionId}/interest`)
      .set('Cookie', bobCookie)
      .send({ refs: [{ kind: 'entity', id: 'sneaky' }] })
      .expect(403);

    await sse.close();
  });

  it('returns 400 (not 500) for a malformed interest body', async () => {
    const cookie = await sessionCookie('ada@hexly.test', 'correct horse');
    const { sse, connectionId } = await connect(cookie);

    await request(app.getHttpServer())
      .put(`/events/${connectionId}/interest`)
      .set('Cookie', cookie)
      .send({ refs: 'not-an-array' })
      .expect(400);

    await sse.close();
  });

  it('returns 404 for an interest PUT to an unknown connectionId', async () => {
    const cookie = await sessionCookie('ada@hexly.test', 'correct horse');
    await request(app.getHttpServer())
      .put('/events/does-not-exist/interest')
      .set('Cookie', cookie)
      .send({ refs: [] })
      .expect(404);
  });

  it('delivers { id, version } to a subscribed viewer when another user saves the Entity', async () => {
    const bobId = await app
      .get(AuthService)
      .seedUser('bob@hexly.test', 'hunter2 stationery', 'Bob');
    const adaCookie = await sessionCookie('ada@hexly.test', 'correct horse');
    const bobCookie = await sessionCookie('bob@hexly.test', 'hunter2 stationery');

    // Ada creates a note (version 1); Bob co-owns it so he may save (ADR-0037).
    const created = await request(app.getHttpServer())
      .post('/entities')
      .set('Cookie', adaCookie)
      .send({ name: 'The Chronicle', type: 'note' })
      .expect(201);
    const entityId = created.body.id as string;
    const document = created.body.document;
    db.insert(entityGrants).values({ entityId, userId: bobId, role: 'owner' }).run();

    // Ada opens the stream and subscribes to the Entity.
    const { sse, connectionId } = await connect(adaCookie);
    await request(app.getHttpServer())
      .put(`/events/${connectionId}/interest`)
      .set('Cookie', adaCookie)
      .send({ refs: [{ kind: 'entity', id: entityId }] })
      .expect(204);

    // Bob saves it (version 1 → 2).
    await request(app.getHttpServer())
      .put(`/entities/${entityId}`)
      .set('Cookie', bobCookie)
      .send({ document, version: 1, tags: [] })
      .expect(200);

    // Ada receives the nudge for exactly that resource, at the bumped version.
    const nudge = await sse.next();
    expect(nudge.event).toBe('nudge');
    expect(nudge.data).toEqual([{ id: entityId, version: 2 }]);

    await sse.close();
  });
});
