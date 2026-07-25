import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { DB, Db, createDb } from '../db/db';
import { entityGrants } from '../db/schema';
import { AuthService } from '../auth/auth.service';
import { AuthModule } from '../auth/auth.module';
import { AdminModule } from './admin.module';
import { UsersModule } from './users.module';
import { WorldsModule } from '../worlds/worlds.module';
import { EntitiesModule } from '../entities/entities.module';
import { ConfigModule } from '../config/config.module';

/**
 * Account management (ADR-0037, ADR-0047): the `manage-users` role administers accounts
 * with zero content powers; the Superadmin sits outside the collaboration model and its
 * bypass reaches anything for repair.
 */
describe('Account management (/users)', () => {
  let app: INestApplication;
  let db: Db;

  beforeEach(async () => {
    db = createDb(':memory:'); // Isolated per-test (ADR-0002).
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, AuthModule, UsersModule, AdminModule, WorldsModule, EntitiesModule],
    })
      .overrideProvider(DB)
      .useValue(db)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    // Listen for real: supertest otherwise churns an ephemeral port per request, and a reused loopback
    // 4-tuple still in TIME_WAIT is RST as `socket hang up`.
    await app.listen(0);
  });

  afterEach(async () => {
    await app.close();
  });

  const PASSWORD = 'correct horse battery';

  /** Seed a plain Instance user with only the `create-worlds` role. Returns their id. */
  async function seedUser(email: string, name: string) {
    return app.get(AuthService).seedUser(email, PASSWORD, name, { roles: ['create-worlds'] });
  }

  /** Seed a `manage-users` holder — the account-management role. */
  async function seedManager(email: string, name: string) {
    return app.get(AuthService).seedUser(email, PASSWORD, name, { roles: ['manage-users'] });
  }

  /** Seed a Superadmin (`is_superadmin`), the outside-the-model repair tier. */
  async function seedSuperadmin(email: string, name: string) {
    return app.get(AuthService).seedUser(email, PASSWORD, name, { isSuperadmin: true });
  }

  async function signIn(email: string, password: string = PASSWORD) {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/auth/login').send({ email, password }).expect(200);
    return agent;
  }

  it('lets a manage-users holder create a user, who can then log in', async () => {
    await seedManager('ada@hexly.test', 'Ada');
    const ada = await signIn('ada@hexly.test');

    await ada.post('/users').send({ email: 'bob@hexly.test', password: PASSWORD, displayName: 'Bob' }).expect(201);

    // The freshly provisioned account is a real, usable login.
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'bob@hexly.test', password: PASSWORD })
      .expect(200);
  });

  it('provisions users with no roles, until a manager grants create-worlds (ADR-0040, ADR-0047)', async () => {
    await seedManager('ada@hexly.test', 'Ada');
    const ada = await signIn('ada@hexly.test');

    await ada.post('/users').send({ email: 'bob@hexly.test', password: PASSWORD, displayName: 'Bob' }).expect(201);
    // In-app provisioned accounts start with the empty role set (unlike seeded bootstrap users).
    const listed = (await ada.get('/users').expect(200)).body as {
      id: string;
      email: string;
      roles: string[];
    }[];
    const bobRow = listed.find((u) => u.email === 'bob@hexly.test');
    expect(bobRow?.roles).toEqual([]);

    const bob = await signIn('bob@hexly.test');
    await bob.post('/worlds').send({ name: 'Nope' }).expect(403);

    // The manager grants the `create-worlds` role; Bob can now create.
    await ada
      .patch(`/users/${bobRow!.id}/roles`)
      .send({ roles: ['create-worlds'] })
      .expect(200);
    await bob.post('/worlds').send({ name: 'Bobland' }).expect(201);
  });

  it('refuses a roles change to a signed-in non-manager (403)', async () => {
    const bobId = await seedUser('bob@hexly.test', 'Bob');
    await seedUser('mallory@hexly.test', 'Mallory');
    const mallory = await signIn('mallory@hexly.test');

    await mallory
      .patch(`/users/${bobId}/roles`)
      .send({ roles: ['create-worlds'] })
      .expect(403);
  });

  it('refuses the users surface to a signed-in non-manager (403)', async () => {
    await seedUser('mallory@hexly.test', 'Mallory');
    const mallory = await signIn('mallory@hexly.test');

    await mallory.post('/users').send({ email: 'x@hexly.test', password: PASSWORD, displayName: 'X' }).expect(403);
  });

  it('refuses the users surface to an anonymous caller (401)', async () => {
    await request(app.getHttpServer())
      .post('/users')
      .send({ email: 'x@hexly.test', password: PASSWORD, displayName: 'X' })
      .expect(401);
  });

  it('grants a manager no content access: 404 on a World/Entity they do not own', async () => {
    // Bob owns a World with an Entity; Ada holds `manage-users` but is not a member.
    const bobId = await seedUser('bob@hexly.test', 'Bob');
    const bob = await signIn('bob@hexly.test');
    const worldId = (await bob.post('/worlds').send({ name: 'Bobland' }).expect(201)).body.id;
    const entityId = (
      await bob
        .post('/entities')
        .send({ name: 'Secret', types: ['core.type.note'], worldId })
        .expect(201)
    ).body.id;

    await seedManager('ada@hexly.test', 'Ada');
    const ada = await signIn('ada@hexly.test');

    // The `manage-users` role is account-only — it pierces no content (ADR-0037, ADR-0047).
    await ada.get(`/worlds/${worldId}`).expect(404);
    await ada.get(`/entities/${entityId}`).expect(404);
    expect((await ada.get('/worlds').expect(200)).body).toEqual([]);
    // The owner still reaches their own data — nothing was taken away.
    await bob.get(`/entities/${entityId}`).expect(200);
    expect(bobId).toBeTruthy();
  });

  it('disable locks login and kills live sessions, preserving data and memberships', async () => {
    const bobId = await seedUser('bob@hexly.test', 'Bob');
    const bob = await signIn('bob@hexly.test');
    const worldId = (await bob.post('/worlds').send({ name: 'Bobland' }).expect(201)).body.id;
    // Bob has a live session (the agent) and reaches his World.
    await bob.get('/auth/me').expect(200);

    await seedManager('ada@hexly.test', 'Ada');
    const ada = await signIn('ada@hexly.test');
    await ada.patch(`/users/${bobId}/disabled`).send({ disabled: true }).expect(200);

    // The live session stops resolving immediately, and a fresh login is refused.
    await bob.get('/auth/me').expect(401);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'bob@hexly.test', password: PASSWORD })
      .expect(401);

    // Data and memberships are intact: enabling restores login and the World is still his.
    await ada.patch(`/users/${bobId}/disabled`).send({ disabled: false }).expect(200);
    const bobAgain = await signIn('bob@hexly.test');
    await bobAgain.get(`/worlds/${worldId}`).expect(200);
    expect((await bobAgain.get('/worlds').expect(200)).body.map((w: { id: string }) => w.id)).toContain(worldId);
  });

  it('lists accounts with email, roles, and disabled state for the panel', async () => {
    const adaId = await seedManager('ada@hexly.test', 'Ada');
    const bobId = await seedUser('bob@hexly.test', 'Bob');
    const ada = await signIn('ada@hexly.test');
    await ada.patch(`/users/${bobId}/disabled`).send({ disabled: true }).expect(200);

    const rows: Array<Record<string, unknown>> = (await ada.get('/users').expect(200)).body;
    const bob = rows.find((r) => r.id === bobId);
    const adaRow = rows.find((r) => r.id === adaId);
    // Email is a management concern (unlike the public /users/directory), and the panel
    // renders the roles set + disabled state.
    expect(bob).toMatchObject({
      email: 'bob@hexly.test',
      displayName: 'Bob',
      roles: ['create-worlds'],
      isSuperadmin: false,
    });
    expect(typeof bob?.disabledAt).toBe('number');
    expect(adaRow).toMatchObject({ roles: ['manage-users'], disabledAt: null });
  });

  it('resets a password: the old one stops working, the new one logs in', async () => {
    const bobId = await seedUser('bob@hexly.test', 'Bob');
    await seedManager('ada@hexly.test', 'Ada');
    const ada = await signIn('ada@hexly.test');

    await ada.post(`/users/${bobId}/password`).send({ password: 'a whole new secret' }).expect(200);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'bob@hexly.test', password: PASSWORD })
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'bob@hexly.test', password: 'a whole new secret' })
      .expect(200);
  });

  it('toggles the manage-users role, which grants and revokes the users surface', async () => {
    const bobId = await seedUser('bob@hexly.test', 'Bob');
    await seedManager('ada@hexly.test', 'Ada');
    const ada = await signIn('ada@hexly.test');

    // Before promotion Bob cannot reach the users surface.
    let bob = await signIn('bob@hexly.test');
    await bob.get('/users').expect(403);

    await ada
      .patch(`/users/${bobId}/roles`)
      .send({ roles: ['manage-users'] })
      .expect(200);
    // A fresh session reads the new role set off the row.
    bob = await signIn('bob@hexly.test');
    await bob.get('/users').expect(200);

    await ada.patch(`/users/${bobId}/roles`).send({ roles: [] }).expect(200);
    bob = await signIn('bob@hexly.test');
    await bob.get('/users').expect(403);
  });

  it('refuses to delete a user who solely owns a World (409), and the account survives', async () => {
    const bobId = await seedUser('bob@hexly.test', 'Bob');
    const bob = await signIn('bob@hexly.test');
    await bob.post('/worlds').send({ name: 'Bobland' }).expect(201); // sole-owned World

    await seedManager('ada@hexly.test', 'Ada');
    const ada = await signIn('ada@hexly.test');
    // The refusal is a structured code, not prose (ADR-0037, ADR-0047).
    expect((await ada.delete(`/users/${bobId}`).expect(409)).body).toEqual({
      code: 'sole-owner',
    });

    // The account is untouched — still listed, still able to log in.
    expect((await ada.get('/users').expect(200)).body.map((r: { id: string }) => r.id)).toContain(bobId);
    await signIn('bob@hexly.test');
  });

  it('refuses to delete a user who solely owns an Entity (409)', async () => {
    // Carol owns a World; an Entity inside it is solely owned by Bob (a member-owned
    // note). Carol stays sole owner of the World, so Bob's only sole ownership is the
    // Entity — isolating the Entity branch of the invariant.
    await seedUser('carol@hexly.test', 'Carol');
    const bobId = await seedUser('bob@hexly.test', 'Bob');
    const carol = await signIn('carol@hexly.test');
    const worldId = (await carol.post('/worlds').send({ name: 'Carolina' }).expect(201)).body.id;
    const noteId = (
      await carol
        .post('/entities')
        .send({ name: 'Ledger', types: ['core.type.note'], worldId })
        .expect(201)
    ).body.id;
    // Reassign sole ownership of the note to Bob (ownership is an `owner`-role grant row).
    db.delete(entityGrants)
      .where(and(eq(entityGrants.entityId, noteId), eq(entityGrants.role, 'owner')))
      .run();
    db.insert(entityGrants).values({ entityId: noteId, userId: bobId, role: 'owner' }).run();

    await seedManager('ada@hexly.test', 'Ada');
    const ada = await signIn('ada@hexly.test');
    await ada.delete(`/users/${bobId}`).expect(409);
  });

  it('deletes a user who solely owns nothing, ending their login and cleaning up their grants', async () => {
    // Carol owns a World; Bob is only a co-member (Carol stays sole owner), never a sole owner.
    const carolId = await seedUser('carol@hexly.test', 'Carol');
    const bobId = await seedUser('bob@hexly.test', 'Bob');
    const carol = await signIn('carol@hexly.test');
    const worldId = (await carol.post('/worlds').send({ name: 'Carolina' }).expect(201)).body.id;
    await carol.post(`/worlds/${worldId}/members`).send({ userId: bobId, role: 'viewer' }).expect(200);

    await seedManager('ada@hexly.test', 'Ada');
    const ada = await signIn('ada@hexly.test');
    await ada.delete(`/users/${bobId}`).expect(200);

    // Gone from the directory and can no longer log in; Carol's World is intact.
    expect((await ada.get('/users').expect(200)).body.map((r: { id: string }) => r.id)).not.toContain(bobId);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'bob@hexly.test', password: PASSWORD })
      .expect(401);
    await carol.get(`/worlds/${worldId}`).expect(200);
    // The removed member's row is gone (no orphaned membership).
    expect((await carol.get(`/worlds/${worldId}/members`).expect(200)).body).toEqual([]);
    expect(carolId).toBeTruthy();
  });

  it('Superadmin reaches a private Entity and an unreachable World (canRead/reachability)', async () => {
    // Bob owns a World with a private Entity; the Superadmin is neither member nor grantee.
    const bob = await signIn((await seedUser('bob@hexly.test', 'Bob')) && 'bob@hexly.test');
    const worldId = (await bob.post('/worlds').send({ name: 'Bobland' }).expect(201)).body.id;
    const entityId = (
      await bob
        .post('/entities')
        .send({ name: 'Secret', types: ['core.type.note'], worldId })
        .expect(201)
    ).body.id; // private by default

    await seedSuperadmin('root@hexly.test', 'Root');
    const root = await signIn('root@hexly.test');

    // The repair tier reaches anything (ADR-0037) — the bypass lives inside canRead/reachability.
    await root.get(`/entities/${entityId}`).expect(200);
    await root.get(`/worlds/${worldId}`).expect(200);
    expect((await root.get('/worlds').expect(200)).body.map((w: { id: string }) => w.id)).toContain(worldId);
  });

  it('Superadmin can repair: reassign an Entity owner and delete stuck data', async () => {
    const bobId = await seedUser('bob@hexly.test', 'Bob');
    const carolId = await seedUser('carol@hexly.test', 'Carol');
    const bob = await signIn('bob@hexly.test');
    const worldId = (await bob.post('/worlds').send({ name: 'Bobland' }).expect(201)).body.id;
    const entityId = (
      await bob
        .post('/entities')
        .send({ name: 'Stuck', types: ['core.type.note'], worldId })
        .expect(201)
    ).body.id;

    await seedSuperadmin('root@hexly.test', 'Root');
    const root = await signIn('root@hexly.test');

    // Reassign owners (owner-management is normally Owner-only) — add Carol as a co-Owner.
    const owners = (await root.post(`/entities/${entityId}/owners`).send({ userId: carolId }).expect(200)).body;
    expect(owners).toEqual(expect.arrayContaining([bobId, carolId]));

    // Delete stuck data — a World the Superadmin doesn't own.
    await root.delete(`/worlds/${worldId}`).expect(204);
    await bob.get(`/worlds/${worldId}`).expect(404);
  });

  it('Superadmin supersedes roles: a Superadmin without manage-users still reaches the users surface', async () => {
    await seedSuperadmin('root@hexly.test', 'Root');
    const root = await signIn('root@hexly.test');
    await root.get('/users').expect(200);
  });

  it('the Superadmin toggle is Superadmin-only: a plain manage-users holder is refused (403)', async () => {
    const bobId = await seedUser('bob@hexly.test', 'Bob');
    await seedManager('ada@hexly.test', 'Ada');
    const ada = await signIn('ada@hexly.test');
    await ada.patch(`/users/${bobId}/superadmin`).send({ isSuperadmin: true }).expect(403);
  });

  it('refuses a plain manager any management of a Superadmin (no login-as-Superadmin escalation)', async () => {
    const rootId = await seedSuperadmin('root@hexly.test', 'Root');
    await seedManager('ada@hexly.test', 'Ada');
    const ada = await signIn('ada@hexly.test');

    // A plain manager outranks no Superadmin: password reset (the escalation), disable,
    // roles change, and delete are all 403 — only a Superadmin manages a Superadmin.
    await ada.post(`/users/${rootId}/password`).send({ password: 'pwn the operator' }).expect(403);
    await ada.patch(`/users/${rootId}/disabled`).send({ disabled: true }).expect(403);
    await ada.patch(`/users/${rootId}/roles`).send({ roles: [] }).expect(403);
    await ada.delete(`/users/${rootId}`).expect(403);

    // The Superadmin's login still works with their original password — nothing changed.
    await signIn('root@hexly.test');
  });

  it('refuses self-lockout: a manager cannot disable, strip their own manage-users, or delete themselves', async () => {
    const adaId = await seedManager('ada@hexly.test', 'Ada');
    const ada = await signIn('ada@hexly.test');

    await ada.patch(`/users/${adaId}/disabled`).send({ disabled: true }).expect(409);
    expect((await ada.patch(`/users/${adaId}/roles`).send({ roles: [] }).expect(409)).body).toEqual({
      code: 'self-manage-users-revoke',
    });
    await ada.delete(`/users/${adaId}`).expect(409);

    // Resetting one's own password is fine (not a lockout) — the guard is scoped to lockouts.
    await ada.post(`/users/${adaId}/password`).send({ password: 'a fresh secret here' }).expect(200);
    await ada.get('/users').expect(200); // still holds manage-users, still signed in
  });

  it('the last Superadmin cannot be removed or demoted, but a second one unlocks it', async () => {
    const rootId = await seedSuperadmin('root@hexly.test', 'Root'); // owns nothing → not a sole owner
    const bobId = await seedUser('bob@hexly.test', 'Bob');
    const root = await signIn('root@hexly.test');

    // The sole Superadmin is irremovable (delete — here the self-delete guard bites first)
    // and un-demotable (toggle), so the repair capability can't be lost. The demote refusal
    // carries the structured code, not prose (ADR-0037, ADR-0047).
    await root.delete(`/users/${rootId}`).expect(409);
    expect((await root.patch(`/users/${rootId}/superadmin`).send({ isSuperadmin: false }).expect(409)).body).toEqual({
      code: 'last-superadmin',
    });

    // Promote a second Superadmin; now the first may step down.
    await root.patch(`/users/${bobId}/superadmin`).send({ isSuperadmin: true }).expect(200);
    await root.patch(`/users/${rootId}/superadmin`).send({ isSuperadmin: false }).expect(200);
  });
});
