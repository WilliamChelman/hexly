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
import { WorldsModule } from '../worlds/worlds.module';
import { EntitiesModule } from '../entities/entities.module';
import { ConfigModule } from '../config/config.module';

/**
 * Admin tiers (ADR-0037, #163): the Instance Admin manages accounts with zero
 * content powers; the Superadmin is the operator's in-app self, outside the
 * collaboration model, whose bypass reaches anything for repair. These specs
 * assert the externally observable rules at the HTTP edge — who can call the
 * admin surface, that the Admin flag confers no content access, disable-vs-delete,
 * the sole-owner deletion refusal, and last-Superadmin irremovability.
 */
describe('Admin tiers', () => {
  let app: INestApplication;
  let db: Db;

  beforeEach(async () => {
    db = createDb(':memory:'); // Isolated per-test (ADR-0002).
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, AuthModule, AdminModule, WorldsModule, EntitiesModule],
    })
      .overrideProvider(DB)
      .useValue(db)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const PASSWORD = 'correct horse battery';

  /** Seed a plain Instance user (no admin flags). Returns their id. */
  async function seedUser(email: string, name: string) {
    return app.get(AuthService).seedUser(email, PASSWORD, name, { canCreateWorlds: true });
  }

  /** Seed an Instance Admin (`is_admin`), the account-management tier. */
  async function seedAdmin(email: string, name: string) {
    return app.get(AuthService).seedUser(email, PASSWORD, name, { isAdmin: true });
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

  it('lets an Instance Admin create a user, who can then log in', async () => {
    await seedAdmin('ada@hexly.test', 'Ada');
    const ada = await signIn('ada@hexly.test');

    await ada
      .post('/admin/users')
      .send({ email: 'bob@hexly.test', password: PASSWORD, displayName: 'Bob' })
      .expect(201);

    // The freshly provisioned account is a real, usable login.
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'bob@hexly.test', password: PASSWORD })
      .expect(200);
  });

  it('provisions users gated from World Creation, until an Admin grants it (ADR-0040)', async () => {
    await seedAdmin('ada@hexly.test', 'Ada');
    const ada = await signIn('ada@hexly.test');

    await ada
      .post('/admin/users')
      .send({ email: 'bob@hexly.test', password: PASSWORD, displayName: 'Bob' })
      .expect(201);
    // In-app provisioned accounts start unable to create (unlike seeded bootstrap users).
    const listed = (await ada.get('/admin/users').expect(200)).body as {
      id: string;
      email: string;
      canCreateWorlds: boolean;
    }[];
    const bobRow = listed.find((u) => u.email === 'bob@hexly.test');
    expect(bobRow?.canCreateWorlds).toBe(false);

    const bob = await signIn('bob@hexly.test');
    await bob.post('/worlds').send({ name: 'Nope' }).expect(403);

    // The Admin grants World Creation; Bob can now create.
    await ada
      .patch(`/admin/users/${bobRow!.id}/can-create-worlds`)
      .send({ canCreateWorlds: true })
      .expect(200);
    await bob.post('/worlds').send({ name: 'Bobland' }).expect(201);
  });

  it('refuses the World-Creation grant to a signed-in non-Admin (403)', async () => {
    const bobId = await seedUser('bob@hexly.test', 'Bob');
    await seedUser('mallory@hexly.test', 'Mallory');
    const mallory = await signIn('mallory@hexly.test');

    await mallory
      .patch(`/admin/users/${bobId}/can-create-worlds`)
      .send({ canCreateWorlds: true })
      .expect(403);
  });

  it('refuses the admin surface to a signed-in non-Admin (403)', async () => {
    await seedUser('mallory@hexly.test', 'Mallory');
    const mallory = await signIn('mallory@hexly.test');

    await mallory
      .post('/admin/users')
      .send({ email: 'x@hexly.test', password: PASSWORD, displayName: 'X' })
      .expect(403);
  });

  it('refuses the admin surface to an anonymous caller (401)', async () => {
    await request(app.getHttpServer())
      .post('/admin/users')
      .send({ email: 'x@hexly.test', password: PASSWORD, displayName: 'X' })
      .expect(401);
  });

  it('grants an Admin no content access: 404 on a World/Entity they do not own', async () => {
    // Bob owns a World with an Entity; Ada is an Instance Admin but not a member.
    const bobId = await seedUser('bob@hexly.test', 'Bob');
    const bob = await signIn('bob@hexly.test');
    const worldId = (await bob.post('/worlds').send({ name: 'Bobland' }).expect(201)).body.id;
    const entityId = (
      await bob.post('/entities').send({ name: 'Secret', type: 'note', worldId }).expect(201)
    ).body.id;

    await seedAdmin('ada@hexly.test', 'Ada');
    const ada = await signIn('ada@hexly.test');

    // The Admin flag is account-only — it pierces no content (ADR-0037).
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

    await seedAdmin('ada@hexly.test', 'Ada');
    const ada = await signIn('ada@hexly.test');
    await ada.patch(`/admin/users/${bobId}/disabled`).send({ disabled: true }).expect(200);

    // The live session stops resolving immediately, and a fresh login is refused.
    await bob.get('/auth/me').expect(401);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'bob@hexly.test', password: PASSWORD })
      .expect(401);

    // Data and memberships are intact: enabling restores login and the World is still his.
    await ada.patch(`/admin/users/${bobId}/disabled`).send({ disabled: false }).expect(200);
    const bobAgain = await signIn('bob@hexly.test');
    await bobAgain.get(`/worlds/${worldId}`).expect(200);
    expect((await bobAgain.get('/worlds').expect(200)).body.map((w: { id: string }) => w.id)).toContain(
      worldId,
    );
  });

  it('lists accounts with email, flags, and disabled state for the admin panel', async () => {
    const adaId = await seedAdmin('ada@hexly.test', 'Ada');
    const bobId = await seedUser('bob@hexly.test', 'Bob');
    const ada = await signIn('ada@hexly.test');
    await ada.patch(`/admin/users/${bobId}/disabled`).send({ disabled: true }).expect(200);

    const rows: Array<Record<string, unknown>> = (await ada.get('/admin/users').expect(200)).body;
    const bob = rows.find((r) => r.id === bobId);
    const adaRow = rows.find((r) => r.id === adaId);
    // Email is an Admin concern (unlike the public /users directory), and the panel
    // renders the flags + disabled state.
    expect(bob).toMatchObject({
      email: 'bob@hexly.test',
      displayName: 'Bob',
      isAdmin: false,
      isSuperadmin: false,
    });
    expect(typeof bob?.disabledAt).toBe('number');
    expect(adaRow).toMatchObject({ isAdmin: true, disabledAt: null });
  });

  it('resets a password: the old one stops working, the new one logs in', async () => {
    const bobId = await seedUser('bob@hexly.test', 'Bob');
    await seedAdmin('ada@hexly.test', 'Ada');
    const ada = await signIn('ada@hexly.test');

    await ada.post(`/admin/users/${bobId}/password`).send({ password: 'a whole new secret' }).expect(200);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'bob@hexly.test', password: PASSWORD })
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'bob@hexly.test', password: 'a whole new secret' })
      .expect(200);
  });

  it('toggles the Admin flag, which grants and revokes the admin surface', async () => {
    const bobId = await seedUser('bob@hexly.test', 'Bob');
    await seedAdmin('ada@hexly.test', 'Ada');
    const ada = await signIn('ada@hexly.test');

    // Before promotion Bob cannot reach the admin surface.
    let bob = await signIn('bob@hexly.test');
    await bob.get('/admin/users').expect(403);

    await ada.patch(`/admin/users/${bobId}/admin`).send({ isAdmin: true }).expect(200);
    // A fresh session reads the new flag off the row.
    bob = await signIn('bob@hexly.test');
    await bob.get('/admin/users').expect(200);

    await ada.patch(`/admin/users/${bobId}/admin`).send({ isAdmin: false }).expect(200);
    bob = await signIn('bob@hexly.test');
    await bob.get('/admin/users').expect(403);
  });

  it('refuses to delete a user who solely owns a World (409), and the account survives', async () => {
    const bobId = await seedUser('bob@hexly.test', 'Bob');
    const bob = await signIn('bob@hexly.test');
    await bob.post('/worlds').send({ name: 'Bobland' }).expect(201); // sole-owned World

    await seedAdmin('ada@hexly.test', 'Ada');
    const ada = await signIn('ada@hexly.test');
    // The refusal is a structured code, not prose (ADR-0037, #163).
    expect((await ada.delete(`/admin/users/${bobId}`).expect(409)).body).toEqual({
      code: 'sole-owner',
    });

    // The account is untouched — still listed, still able to log in.
    expect(
      (await ada.get('/admin/users').expect(200)).body.map((r: { id: string }) => r.id),
    ).toContain(bobId);
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
      await carol.post('/entities').send({ name: 'Ledger', type: 'note', worldId }).expect(201)
    ).body.id;
    // Reassign sole ownership of the note to Bob (ownership is an `owner`-role grant row).
    db.delete(entityGrants).where(and(eq(entityGrants.entityId, noteId), eq(entityGrants.role, 'owner'))).run();
    db.insert(entityGrants).values({ entityId: noteId, userId: bobId, role: 'owner' }).run();

    await seedAdmin('ada@hexly.test', 'Ada');
    const ada = await signIn('ada@hexly.test');
    await ada.delete(`/admin/users/${bobId}`).expect(409);
  });

  it('deletes a user who solely owns nothing, ending their login and cleaning up their grants', async () => {
    // Carol owns a World; Bob is only a co-member (Carol stays sole owner), never a sole owner.
    const carolId = await seedUser('carol@hexly.test', 'Carol');
    const bobId = await seedUser('bob@hexly.test', 'Bob');
    const carol = await signIn('carol@hexly.test');
    const worldId = (await carol.post('/worlds').send({ name: 'Carolina' }).expect(201)).body.id;
    await carol.post(`/worlds/${worldId}/members`).send({ userId: bobId, role: 'viewer' }).expect(200);

    await seedAdmin('ada@hexly.test', 'Ada');
    const ada = await signIn('ada@hexly.test');
    await ada.delete(`/admin/users/${bobId}`).expect(200);

    // Gone from the directory and can no longer log in; Carol's World is intact.
    expect(
      (await ada.get('/admin/users').expect(200)).body.map((r: { id: string }) => r.id),
    ).not.toContain(bobId);
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
      await bob.post('/entities').send({ name: 'Secret', type: 'note', worldId }).expect(201)
    ).body.id; // private by default

    await seedSuperadmin('root@hexly.test', 'Root');
    const root = await signIn('root@hexly.test');

    // The repair tier reaches anything (ADR-0037) — the bypass lives inside canRead/reachability.
    await root.get(`/entities/${entityId}`).expect(200);
    await root.get(`/worlds/${worldId}`).expect(200);
    expect((await root.get('/worlds').expect(200)).body.map((w: { id: string }) => w.id)).toContain(
      worldId,
    );
  });

  it('Superadmin can repair: reassign an Entity owner and delete stuck data', async () => {
    const bobId = await seedUser('bob@hexly.test', 'Bob');
    const carolId = await seedUser('carol@hexly.test', 'Carol');
    const bob = await signIn('bob@hexly.test');
    const worldId = (await bob.post('/worlds').send({ name: 'Bobland' }).expect(201)).body.id;
    const entityId = (
      await bob.post('/entities').send({ name: 'Stuck', type: 'note', worldId }).expect(201)
    ).body.id;

    await seedSuperadmin('root@hexly.test', 'Root');
    const root = await signIn('root@hexly.test');

    // Reassign owners (owner-management is normally Owner-only) — add Carol as a co-Owner.
    const owners = (
      await root.post(`/entities/${entityId}/owners`).send({ userId: carolId }).expect(200)
    ).body;
    expect(owners).toEqual(expect.arrayContaining([bobId, carolId]));

    // Delete stuck data — a World the Superadmin doesn't own.
    await root.delete(`/worlds/${worldId}`).expect(204);
    await bob.get(`/worlds/${worldId}`).expect(404);
  });

  it('Superadmin ⊇ Admin: a Superadmin without the Admin flag still reaches the admin surface', async () => {
    await seedSuperadmin('root@hexly.test', 'Root');
    const root = await signIn('root@hexly.test');
    await root.get('/admin/users').expect(200);
  });

  it('the Superadmin toggle is Superadmin-only: a plain Instance Admin is refused (403)', async () => {
    const bobId = await seedUser('bob@hexly.test', 'Bob');
    await seedAdmin('ada@hexly.test', 'Ada');
    const ada = await signIn('ada@hexly.test');
    await ada.patch(`/admin/users/${bobId}/superadmin`).send({ isSuperadmin: true }).expect(403);
  });

  it('refuses a plain Admin any management of a Superadmin (no login-as-Superadmin escalation)', async () => {
    const rootId = await seedSuperadmin('root@hexly.test', 'Root');
    await seedAdmin('ada@hexly.test', 'Ada');
    const ada = await signIn('ada@hexly.test');

    // A plain Admin outranks no Superadmin: password reset (the escalation), disable,
    // Admin-flag toggle, and delete are all 403 — only a Superadmin manages a Superadmin.
    await ada.post(`/admin/users/${rootId}/password`).send({ password: 'pwn the operator' }).expect(403);
    await ada.patch(`/admin/users/${rootId}/disabled`).send({ disabled: true }).expect(403);
    await ada.patch(`/admin/users/${rootId}/admin`).send({ isAdmin: false }).expect(403);
    await ada.delete(`/admin/users/${rootId}`).expect(403);

    // The Superadmin's login still works with their original password — nothing changed.
    await signIn('root@hexly.test');
  });

  it('refuses self-lockout: an admin cannot disable, demote, or delete their own account', async () => {
    const adaId = await seedAdmin('ada@hexly.test', 'Ada');
    const ada = await signIn('ada@hexly.test');

    await ada.patch(`/admin/users/${adaId}/disabled`).send({ disabled: true }).expect(409);
    await ada.patch(`/admin/users/${adaId}/admin`).send({ isAdmin: false }).expect(409);
    await ada.delete(`/admin/users/${adaId}`).expect(409);

    // Resetting one's own password is fine (not a lockout) — the guard is scoped to lockouts.
    await ada.post(`/admin/users/${adaId}/password`).send({ password: 'a fresh secret here' }).expect(200);
    await ada.get('/admin/users').expect(200); // still an Admin, still signed in
  });

  it('the last Superadmin cannot be removed or demoted, but a second one unlocks it', async () => {
    const rootId = await seedSuperadmin('root@hexly.test', 'Root'); // owns nothing → not a sole owner
    const bobId = await seedUser('bob@hexly.test', 'Bob');
    const root = await signIn('root@hexly.test');

    // The sole Superadmin is irremovable (delete — here the self-delete guard bites first)
    // and un-demotable (toggle), so the repair capability can't be lost. The demote refusal
    // carries the structured code, not prose (ADR-0037, #163).
    await root.delete(`/admin/users/${rootId}`).expect(409);
    expect(
      (await root.patch(`/admin/users/${rootId}/superadmin`).send({ isSuperadmin: false }).expect(409)).body,
    ).toEqual({ code: 'last-superadmin' });

    // Promote a second Superadmin; now the first may step down.
    await root.patch(`/admin/users/${bobId}/superadmin`).send({ isSuperadmin: true }).expect(200);
    await root.patch(`/admin/users/${rootId}/superadmin`).send({ isSuperadmin: false }).expect(200);
  });
});
