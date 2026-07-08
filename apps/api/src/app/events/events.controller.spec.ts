import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DB, Db, createDb } from '../db/db';
import { entityGrants, worldMembers } from '../db/schema';
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
    return openSseAt('/events', { cookie });
  }

  /** Open the SSE stream at an arbitrary path/headers (cookie principal or `?token=`). */
  async function openSseAt(path: string, headers: Record<string, string>) {
    const res = await fetch(baseUrl + path, { headers });
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
    expect(nudge.data).toEqual([
      { id: entityId, version: 2, updatedAt: expect.any(Number) },
    ]);

    await sse.close();
  });

  it('delivers { id, version } to a follower when the Entity is renamed', async () => {
    const adaCookie = await sessionCookie('ada@hexly.test', 'correct horse');
    const created = await request(app.getHttpServer())
      .post('/entities')
      .set('Cookie', adaCookie)
      .send({ name: 'The Chronicle', type: 'note' })
      .expect(201);
    const entityId = created.body.id as string;

    const { sse, connectionId } = await connect(adaCookie);
    await request(app.getHttpServer())
      .put(`/events/${connectionId}/interest`)
      .set('Cookie', adaCookie)
      .send({ refs: [{ kind: 'entity', id: entityId }] })
      .expect(204);

    await request(app.getHttpServer())
      .patch(`/entities/${entityId}`)
      .set('Cookie', adaCookie)
      .send({ name: 'The Amended Chronicle' })
      .expect(200);

    // A patch never bumps version (it must not invalidate in-progress edits) — the fresh
    // `updatedAt` is what lets a follower see a same-version rename as newer than held.
    const nudge = await sse.next();
    expect(nudge.event).toBe('nudge');
    expect(nudge.data).toEqual([
      { id: entityId, version: 1, updatedAt: expect.any(Number) },
    ]);

    await sse.close();
  });

  it('shapes one private-flip event per recipient: world-share follower evicted, grant holder kept (ADR-0044)', async () => {
    // Bob follows via world-share (World Viewer); Carol holds a separate entity-level
    // Viewer grant, which pierces `private`. One mutation event, correct per person.
    const bobId = await app
      .get(AuthService)
      .seedUser('bob@hexly.test', 'hunter2 stationery', 'Bob');
    const carolId = await app
      .get(AuthService)
      .seedUser('carol@hexly.test', 'lovelace engine', 'Carol');
    const adaCookie = await sessionCookie('ada@hexly.test', 'correct horse');
    const bobCookie = await sessionCookie('bob@hexly.test', 'hunter2 stationery');
    const carolCookie = await sessionCookie('carol@hexly.test', 'lovelace engine');

    const created = await request(app.getHttpServer())
      .post('/entities')
      .set('Cookie', adaCookie)
      .send({ name: 'The Chronicle', type: 'note' })
      .expect(201);
    const entityId = created.body.id as string;
    const worldId = created.body.worldId as string;
    await request(app.getHttpServer())
      .patch(`/entities/${entityId}`)
      .set('Cookie', adaCookie)
      .send({ visibility: 'shared' })
      .expect(200);
    db.insert(worldMembers).values({ worldId, userId: bobId, role: 'viewer' }).run();
    db.insert(entityGrants).values({ entityId, userId: carolId, role: 'viewer' }).run();

    const bob = await connect(bobCookie);
    await request(app.getHttpServer())
      .put(`/events/${bob.connectionId}/interest`)
      .set('Cookie', bobCookie)
      .send({ refs: [{ kind: 'entity', id: entityId }] })
      .expect(204);
    const carol = await connect(carolCookie);
    await request(app.getHttpServer())
      .put(`/events/${carol.connectionId}/interest`)
      .set('Cookie', carolCookie)
      .send({ refs: [{ kind: 'entity', id: entityId }] })
      .expect(204);

    await request(app.getHttpServer())
      .patch(`/entities/${entityId}`)
      .set('Cookie', adaCookie)
      .send({ visibility: 'private' })
      .expect(200);

    // Bob's world-share standing ends with the flip → opaque, version-free eviction.
    const bobNudge = await bob.sse.next();
    expect(bobNudge.event).toBe('nudge');
    expect(bobNudge.data).toEqual([{ id: entityId, unavailable: true }]);
    // Carol's grant survives the flip → she keeps following, same event.
    const carolNudge = await carol.sse.next();
    expect(carolNudge.event).toBe('nudge');
    expect(carolNudge.data).toEqual([
      { id: entityId, version: 1, updatedAt: expect.any(Number) },
    ]);

    await bob.sse.close();
    await carol.sse.close();
  });

  it('evicts followers to opaque, version-free { id, unavailable } when the Entity is deleted', async () => {
    const adaCookie = await sessionCookie('ada@hexly.test', 'correct horse');
    const created = await request(app.getHttpServer())
      .post('/entities')
      .set('Cookie', adaCookie)
      .send({ name: 'The Chronicle', type: 'note' })
      .expect(201);
    const entityId = created.body.id as string;

    const { sse, connectionId } = await connect(adaCookie);
    await request(app.getHttpServer())
      .put(`/events/${connectionId}/interest`)
      .set('Cookie', adaCookie)
      .send({ refs: [{ kind: 'entity', id: entityId }] })
      .expect(204);

    await request(app.getHttpServer())
      .delete(`/entities/${entityId}`)
      .set('Cookie', adaCookie)
      .expect(204);

    // Deleted rides the same shaping path as unauthorized — the exact match proves the
    // entry is byte-identical to the private-flip eviction and carries no version.
    const nudge = await sse.next();
    expect(nudge.event).toBe('nudge');
    expect(nudge.data).toEqual([{ id: entityId, unavailable: true }]);

    await sse.close();
  });

  /**
   * Seam B principal (ADR-0044, #175): a Public Link *token* opens the stream in place of a
   * session cookie — the anonymous audience. Ada authors a note and mints its per-entity link;
   * the token is the grant, resolving the same single access seam a `GET /public/…` does.
   */
  async function linkedEntity() {
    const cookie = await sessionCookie('ada@hexly.test', 'correct horse');
    const created = await request(app.getHttpServer())
      .post('/entities')
      .set('Cookie', cookie)
      .send({ name: 'The Chronicle', type: 'note' })
      .expect(201);
    const entityId = created.body.id as string;
    const link = await request(app.getHttpServer())
      .post(`/entities/${entityId}/link`)
      .set('Cookie', cookie)
      .expect(200);
    return { cookie, entityId, document: created.body.document, token: link.body.token as string };
  }

  /** Open the SSE stream authenticated by a Public Link token query param (no cookie). */
  async function connectToken(token: string) {
    const sse = await openSseAt(`/events?token=${token}`, {});
    const ready = (await sse.next()).data as { connectionId: string };
    return { sse, connectionId: ready.connectionId };
  }

  it('opens a stream for a Public Link token principal (no session cookie), minting a connectionId', async () => {
    const { token } = await linkedEntity();
    const sse = await openSseAt(`/events?token=${token}`, {});

    expect(sse.contentType).toContain('text/event-stream');
    const first = await sse.next();
    expect(first.event).toBe('ready');
    expect(first.data).toEqual({ connectionId: expect.any(String) });

    await sse.close();
  });

  it('resolves a token principal like a cookie one: a link follower gets { id, version } when the GM saves', async () => {
    const { cookie, entityId, document, token } = await linkedEntity();

    // Anonymous viewer opens with the token and subscribes to the linked Entity.
    const { sse, connectionId } = await connectToken(token);
    await request(app.getHttpServer())
      .put(`/events/${connectionId}/interest?token=${token}`)
      .send({ refs: [{ kind: 'entity', id: entityId }] })
      .expect(204);

    // The GM (Ada) saves it (version 1 → 2).
    await request(app.getHttpServer())
      .put(`/entities/${entityId}`)
      .set('Cookie', cookie)
      .send({ document, version: 1, tags: [] })
      .expect(200);

    const nudge = await sse.next();
    expect(nudge.event).toBe('nudge');
    expect(nudge.data).toEqual([{ id: entityId, version: 2, updatedAt: expect.any(Number) }]);

    await sse.close();
  });

  it('evicts a token follower to opaque { id, unavailable } when the Owner revokes the link', async () => {
    const { cookie, entityId, token } = await linkedEntity();

    const { sse, connectionId } = await connectToken(token);
    await request(app.getHttpServer())
      .put(`/events/${connectionId}/interest?token=${token}`)
      .send({ refs: [{ kind: 'entity', id: entityId }] })
      .expect(204);

    // Revoke rides the same shaping event (ADR-0044, #175): the token now grants nothing, so the
    // follower resolves to opaque, version-free eviction — access withdrawal on the open screen.
    await request(app.getHttpServer())
      .delete(`/entities/${entityId}/link`)
      .set('Cookie', cookie)
      .expect(204);

    const nudge = await sse.next();
    expect(nudge.event).toBe('nudge');
    expect(nudge.data).toEqual([{ id: entityId, unavailable: true }]);

    await sse.close();
  });

  it('resolves a World-link token (viaWorld branch) and evicts its followers when the World link is revoked', async () => {
    const adaCookie = await sessionCookie('ada@hexly.test', 'correct horse');
    const created = await request(app.getHttpServer())
      .post('/entities')
      .set('Cookie', adaCookie)
      .send({ name: 'The Chronicle', type: 'note' })
      .expect(201);
    const entityId = created.body.id as string;
    const worldId = created.body.worldId as string;
    const document = created.body.document;
    // A World link only reaches `shared` Entities (ADR-0037), so surface it before minting.
    await request(app.getHttpServer())
      .patch(`/entities/${entityId}`)
      .set('Cookie', adaCookie)
      .send({ visibility: 'shared' })
      .expect(200);
    const link = await request(app.getHttpServer())
      .post(`/worlds/${worldId}/link`)
      .set('Cookie', adaCookie)
      .expect(200);
    const token = link.body.token as string;

    // Anon opens with the World token and subscribes to the shared Entity — reachable only through
    // the viaWorld branch (no per-entity link exists).
    const { sse, connectionId } = await connectToken(token);
    await request(app.getHttpServer())
      .put(`/events/${connectionId}/interest?token=${token}`)
      .send({ refs: [{ kind: 'entity', id: entityId }] })
      .expect(204);

    // GM saves → the world-link follower gets the version nudge (viaWorld reachability holds).
    await request(app.getHttpServer())
      .put(`/entities/${entityId}`)
      .set('Cookie', adaCookie)
      .send({ document, version: 1, tags: [] })
      .expect(200);
    const nudge = await sse.next();
    expect(nudge.data).toEqual([{ id: entityId, version: 2, updatedAt: expect.any(Number) }]);

    // Revoking the World link evicts the world-link follower — the same guarantee as the entity path.
    await request(app.getHttpServer())
      .delete(`/worlds/${worldId}/link`)
      .set('Cookie', adaCookie)
      .expect(204);
    const evicted = await sse.next();
    expect(evicted.data).toEqual([{ id: entityId, unavailable: true }]);

    await sse.close();
  });

  it('lets a `?token=` win over a present session cookie — a signed-in viewer follows as the link grants', async () => {
    // Bob is signed in but has no standing on Ada's private Entity; the link token does. Opening
    // with both his cookie and the token must follow as the *token* (readable), not as Bob (who
    // would have the ref silently filtered) — the SSE connection is token-scoped like GET /public.
    await app.get(AuthService).seedUser('bob@hexly.test', 'hunter2 stationery', 'Bob');
    const { cookie, entityId, document, token } = await linkedEntity();
    const bobCookie = await sessionCookie('bob@hexly.test', 'hunter2 stationery');

    const sse = await openSseAt(`/events?token=${token}`, { cookie: bobCookie });
    const connectionId = (await sse.next()).data as { connectionId: string };
    await request(app.getHttpServer())
      .put(`/events/${connectionId.connectionId}/interest?token=${token}`)
      .set('Cookie', bobCookie)
      .send({ refs: [{ kind: 'entity', id: entityId }] })
      .expect(204);

    await request(app.getHttpServer())
      .put(`/entities/${entityId}`)
      .set('Cookie', cookie)
      .send({ document, version: 1, tags: [] })
      .expect(200);

    const nudge = await sse.next();
    expect(nudge.event).toBe('nudge');
    expect(nudge.data).toEqual([{ id: entityId, version: 2, updatedAt: expect.any(Number) }]);

    await sse.close();
  });

  it('confines a token principal to the Entity it grants — a sibling id it does not grant is silently not-subscribed', async () => {
    const { cookie, entityId: grantedId, token } = await linkedEntity();
    // A second, unlinked note the token grants no access to.
    const other = await request(app.getHttpServer())
      .post('/entities')
      .set('Cookie', cookie)
      .send({ name: 'Sealed Archive', type: 'note' })
      .expect(201);
    const forbiddenId = other.body.id as string;

    const { sse, connectionId } = await connectToken(token);
    await request(app.getHttpServer())
      .put(`/events/${connectionId}/interest?token=${token}`)
      .send({
        refs: [
          { kind: 'entity', id: forbiddenId },
          { kind: 'entity', id: grantedId },
        ],
      })
      .expect(204);

    // Mutate the forbidden one first: if its ref had stuck, its nudge would arrive first. The
    // granted one being the first (and only) frame proves the forbidden ref delivered nothing.
    await request(app.getHttpServer())
      .patch(`/entities/${forbiddenId}`)
      .set('Cookie', cookie)
      .send({ name: 'Sealed Deeper' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/entities/${grantedId}`)
      .set('Cookie', cookie)
      .send({ name: 'Open Wider' })
      .expect(200);

    const nudge = await sse.next();
    expect(nudge.event).toBe('nudge');
    expect(nudge.data).toEqual([{ id: grantedId, version: 1, updatedAt: expect.any(Number) }]);

    await sse.close();
  });

  it('silently drops forbidden and nonexistent refs at subscribe time — no nudge is ever delivered for them', async () => {
    // Existence must not be probeable by subscribing to guessed ids (ADR-0044): the PUT
    // still 204s (silent), but a follower only ever hears about resources it could read
    // when it subscribed.
    const bobId = await app
      .get(AuthService)
      .seedUser('bob@hexly.test', 'hunter2 stationery', 'Bob');
    const adaCookie = await sessionCookie('ada@hexly.test', 'correct horse');
    const bobCookie = await sessionCookie('bob@hexly.test', 'hunter2 stationery');

    // Ada's `private` Entities: `hidden` (no standing for Bob) and `granted` (Bob is Viewer).
    const mkEntity = async (name: string) => {
      const res = await request(app.getHttpServer())
        .post('/entities')
        .set('Cookie', adaCookie)
        .send({ name, type: 'note' })
        .expect(201);
      return res.body.id as string;
    };
    const hiddenId = await mkEntity('Sealed Archive');
    const grantedId = await mkEntity('Open Ledger');
    db.insert(entityGrants).values({ entityId: grantedId, userId: bobId, role: 'viewer' }).run();

    // Bob declares interest in the forbidden id, a guessed id, and the granted one: 204,
    // indistinguishable from a fully honored PUT.
    const bob = await connect(bobCookie);
    await request(app.getHttpServer())
      .put(`/events/${bob.connectionId}/interest`)
      .set('Cookie', bobCookie)
      .send({
        refs: [
          { kind: 'entity', id: hiddenId },
          { kind: 'entity', id: 'no-such-entity' },
          { kind: 'entity', id: grantedId },
        ],
      })
      .expect(204);

    // Mutate the forbidden Entity first, then the granted one. If the forbidden ref had
    // stuck, its nudge would arrive first — so Bob's first frame being the granted one
    // proves the forbidden ref delivered nothing.
    await request(app.getHttpServer())
      .patch(`/entities/${hiddenId}`)
      .set('Cookie', adaCookie)
      .send({ name: 'Sealed Deeper' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/entities/${grantedId}`)
      .set('Cookie', adaCookie)
      .send({ name: 'Open Wider' })
      .expect(200);

    const nudge = await bob.sse.next();
    expect(nudge.event).toBe('nudge');
    expect(nudge.data).toEqual([
      { id: grantedId, version: 1, updatedAt: expect.any(Number) },
    ]);

    await bob.sse.close();
  });

  /** Ada's sole World (minted in beforeEach), via her authorized list read. */
  async function adaWorldId(cookie: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .get('/worlds')
      .set('Cookie', cookie)
      .expect(200);
    return res.body[0].id as string;
  }

  it('delivers { id, updatedAt } to a follower when a World is renamed (a World is just another ref)', async () => {
    const adaCookie = await sessionCookie('ada@hexly.test', 'correct horse');
    const worldId = await adaWorldId(adaCookie);

    const { sse, connectionId } = await connect(adaCookie);
    await request(app.getHttpServer())
      .put(`/events/${connectionId}/interest`)
      .set('Cookie', adaCookie)
      .send({ refs: [{ kind: 'world', id: worldId }] })
      .expect(204);

    await request(app.getHttpServer())
      .patch(`/worlds/${worldId}`)
      .set('Cookie', adaCookie)
      .send({ name: 'Aldermoor Reborn' })
      .expect(200);

    // A World has no version column; the readable world nudge carries updatedAt only.
    const nudge = await sse.next();
    expect(nudge.event).toBe('nudge');
    expect(nudge.data).toEqual([{ id: worldId, updatedAt: expect.any(Number) }]);

    await sse.close();
  });

  it('evicts a World follower to opaque, version-free { id, unavailable } when the World is deleted', async () => {
    const adaCookie = await sessionCookie('ada@hexly.test', 'correct horse');
    const worldId = await adaWorldId(adaCookie);

    const { sse, connectionId } = await connect(adaCookie);
    await request(app.getHttpServer())
      .put(`/events/${connectionId}/interest`)
      .set('Cookie', adaCookie)
      .send({ refs: [{ kind: 'world', id: worldId }] })
      .expect(204);

    await request(app.getHttpServer())
      .delete(`/worlds/${worldId}`)
      .set('Cookie', adaCookie)
      .expect(204);

    // Deleted rides the same shaping path as unauthorized — byte-identical, version-free.
    const nudge = await sse.next();
    expect(nudge.event).toBe('nudge');
    expect(nudge.data).toEqual([{ id: worldId, unavailable: true }]);

    await sse.close();
  });

  it('shapes one member-removal event per recipient: removed member evicted, remaining Owner kept (ADR-0044)', async () => {
    // Bob follows via a World Viewer membership; Ada owns it. Removing Bob is one mutation event,
    // correct per person — Bob loses reachability (opaque eviction), Ada keeps it (version-free
    // detail nudge). This is the worlds-list disappearance from user story 16.
    const bobId = await app
      .get(AuthService)
      .seedUser('bob@hexly.test', 'hunter2 stationery', 'Bob');
    const adaCookie = await sessionCookie('ada@hexly.test', 'correct horse');
    const bobCookie = await sessionCookie('bob@hexly.test', 'hunter2 stationery');
    const worldId = await adaWorldId(adaCookie);
    db.insert(worldMembers).values({ worldId, userId: bobId, role: 'viewer' }).run();

    const bob = await connect(bobCookie);
    await request(app.getHttpServer())
      .put(`/events/${bob.connectionId}/interest`)
      .set('Cookie', bobCookie)
      .send({ refs: [{ kind: 'world', id: worldId }] })
      .expect(204);
    const ada = await connect(adaCookie);
    await request(app.getHttpServer())
      .put(`/events/${ada.connectionId}/interest`)
      .set('Cookie', adaCookie)
      .send({ refs: [{ kind: 'world', id: worldId }] })
      .expect(204);

    await request(app.getHttpServer())
      .delete(`/worlds/${worldId}/members/${bobId}`)
      .set('Cookie', adaCookie)
      .expect(200);

    const bobNudge = await bob.sse.next();
    expect(bobNudge.data).toEqual([{ id: worldId, unavailable: true }]);
    const adaNudge = await ada.sse.next();
    expect(adaNudge.data).toEqual([{ id: worldId, updatedAt: expect.any(Number) }]);

    await bob.sse.close();
    await ada.sse.close();
  });

  it('nudges an existing follower on an additive membership change (promotion), with a freshened updatedAt', async () => {
    // A World Viewer already follows the World; promoting them to Owner grants `manage`, so the
    // additive membership path must nudge too (not only removals) or their UI stays stale until a
    // focus-refetch. The nudge's updatedAt is bumped, so a newer-than-held consumer can't drop it.
    const bobId = await app
      .get(AuthService)
      .seedUser('bob@hexly.test', 'hunter2 stationery', 'Bob');
    const adaCookie = await sessionCookie('ada@hexly.test', 'correct horse');
    const bobCookie = await sessionCookie('bob@hexly.test', 'hunter2 stationery');
    const worldId = await adaWorldId(adaCookie);
    db.insert(worldMembers).values({ worldId, userId: bobId, role: 'viewer' }).run();
    const before = (await request(app.getHttpServer()).get('/worlds').set('Cookie', bobCookie))
      .body[0].updatedAt as number;

    const bob = await connect(bobCookie);
    await request(app.getHttpServer())
      .put(`/events/${bob.connectionId}/interest`)
      .set('Cookie', bobCookie)
      .send({ refs: [{ kind: 'world', id: worldId }] })
      .expect(204);

    await request(app.getHttpServer())
      .post(`/worlds/${worldId}/owners`)
      .set('Cookie', adaCookie)
      .send({ userId: bobId })
      .expect(200);

    const nudge = await bob.sse.next();
    expect(nudge.data).toEqual([{ id: worldId, updatedAt: expect.any(Number) }]);
    // The membership change bumped updatedAt, so the nudge carries the current (fresh) value.
    const after = (await request(app.getHttpServer()).get('/worlds').set('Cookie', bobCookie))
      .body[0].updatedAt as number;
    expect((nudge.data as { updatedAt: number }[])[0].updatedAt).toBe(after);
    expect(after).toBeGreaterThanOrEqual(before);

    await bob.sse.close();
  });

  it('never delivers a World nudge to a principal with no access to it — silently not-subscribed', async () => {
    // Bob can't reach Ada's World, so subscribing to it is silently dropped (existence/activity
    // must not leak, user story 18). His own note is the tell-tale: mutating the forbidden World
    // first, then his note, his first frame being the note proves the World ref delivered nothing.
    const bobId = await app
      .get(AuthService)
      .seedUser('bob@hexly.test', 'hunter2 stationery', 'Bob', { canCreateWorlds: true });
    app.get(WorldsService).mintWorld(bobId, 'Bobland');
    const adaCookie = await sessionCookie('ada@hexly.test', 'correct horse');
    const bobCookie = await sessionCookie('bob@hexly.test', 'hunter2 stationery');
    const adaWorld = await adaWorldId(adaCookie);

    const bobNote = await request(app.getHttpServer())
      .post('/entities')
      .set('Cookie', bobCookie)
      .send({ name: 'Bob’s Ledger', type: 'note' })
      .expect(201);
    const bobEntityId = bobNote.body.id as string;

    const bob = await connect(bobCookie);
    await request(app.getHttpServer())
      .put(`/events/${bob.connectionId}/interest`)
      .set('Cookie', bobCookie)
      .send({
        refs: [
          { kind: 'world', id: adaWorld },
          { kind: 'entity', id: bobEntityId },
        ],
      })
      .expect(204);

    // Rename Ada's World first (Bob can't reach it), then Bob's note.
    await request(app.getHttpServer())
      .patch(`/worlds/${adaWorld}`)
      .set('Cookie', adaCookie)
      .send({ name: 'Sealed Realm' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/entities/${bobEntityId}`)
      .set('Cookie', bobCookie)
      .send({ name: 'Bob’s Amended Ledger' })
      .expect(200);

    const nudge = await bob.sse.next();
    expect(nudge.data).toEqual([{ id: bobEntityId, version: 1, updatedAt: expect.any(Number) }]);

    await bob.sse.close();
  });
});
