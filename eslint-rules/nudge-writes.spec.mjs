/**
 * Tests for eslint-rules/nudge-writes.mjs.
 * Run: node --test eslint-rules/nudge-writes.spec.mjs  (from repo root)
 *
 * RuleTester throws on failures, so each `tester.run(...)` call is itself the assertion.
 * A rule with a typo'd selector silently matches nothing and passes CI — hence this file.
 */
import { RuleTester } from 'eslint';
import { describe, it } from 'node:test';
import nudgeWrites from './nudge-writes.mjs';

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } });

/** Any file that is neither write handle. */
const CALLER = '/repo/apps/api/src/app/entities/entities.service.ts';
const ENTITY_OWNER = '/repo/apps/api/src/app/entities/entity-writes.ts';
const WORLD_OWNER = '/repo/apps/api/src/app/worlds/world-writes.ts';

describe('no-direct-entity-writes', () => {
  const rule = nudgeWrites.rules['no-direct-entity-writes'];

  it('bans writes to `entities` and `entity_grants` outside EntityWrites', () => {
    tester.run('no-direct-entity-writes', rule, {
      valid: [
        // Reads are untouched — the choke point is on writes, not the access seam.
        { code: 'db.select().from(entities).where(x).get()', filename: CALLER },
        { code: 'db.selectDistinct({ d }).from(entityGrants).all()', filename: CALLER },
        // Sibling tables are not guarded: they carry no `seq` and nudge nobody.
        { code: 'db.delete(entityDescriptors).where(x).run()', filename: CALLER },
        { code: 'db.insert(entityLinks).values(row).run()', filename: CALLER },
        // The World tables are the *other* rule's business.
        { code: 'db.update(worlds).set(x).where(y).run()', filename: CALLER },
        { code: 'db.delete(worldMembers).where(x).run()', filename: CALLER },
        // EntityWrites *is* the write handle, so it may write them.
        { code: 'this.db.update(entities).set({ seq }).where(x).run()', filename: ENTITY_OWNER },
        { code: 'this.db.insert(entityGrants).values(row).run()', filename: ENTITY_OWNER },
        { code: 'this.db.delete(entityGrants).where(x).run()', filename: ENTITY_OWNER },
        // WorldWrites is not exempt from *this* rule — it must not reach into `entities` itself,
        // which is why its shared-Entity fan-out delegates to EntityWrites.bumpWorldShared.
      ],
      invalid: [
        {
          code: 'this.db.update(entities).set({ name }).where(x).run()',
          filename: CALLER,
          errors: [{ messageId: 'direct' }],
        },
        {
          code: 'this.db.delete(entities).where(eq(entities.id, id)).run()',
          filename: CALLER,
          errors: [{ messageId: 'direct' }],
        },
        {
          code: 'this.db.insert(entities).values(row).run()',
          filename: CALLER,
          errors: [{ messageId: 'direct' }],
        },
        // The two ACL writes ADR-0044 shipped without an emit.
        {
          code: 'this.db.delete(entityGrants).where(and(a, b)).run()',
          filename: CALLER,
          errors: [{ messageId: 'direct' }],
        },
        {
          code: 'this.db.insert(entityGrants).values({ role }).run()',
          filename: CALLER,
          errors: [{ messageId: 'direct' }],
        },
        {
          code: 'this.db.update(entityGrants).set({ role }).where(x).run()',
          filename: CALLER,
          errors: [{ messageId: 'direct' }],
        },
        // A transaction handle is no escape hatch — `tx.delete(entityGrants)` is the exact
        // shape admin.service used to purge a deleted user's grants.
        {
          code: 'this.db.transaction((tx) => { tx.delete(entityGrants).where(x).run(); })',
          filename: CALLER,
          errors: [{ messageId: 'direct' }],
        },
        // Two writes, two reports — the rule must not stop at the first.
        {
          code: 'db.update(entities).set(a).run(); db.delete(entityGrants).where(b).run();',
          filename: CALLER,
          errors: [{ messageId: 'direct' }, { messageId: 'direct' }],
        },
        // The World write handle is exempt from the World rule, not this one.
        {
          code: 'this.db.update(entities).set({ seq }).where(x).run()',
          filename: WORLD_OWNER,
          errors: [{ messageId: 'direct' }],
        },
      ],
    });
  });

  it('bans raw SQL that writes the guarded tables, which the drizzle selector cannot see', () => {
    tester.run('no-direct-entity-writes', rule, {
      valid: [
        { code: "sqlite.prepare(`INSERT INTO worlds (id) VALUES (?)`).run(id)", filename: CALLER },
        { code: "db.$client.prepare('SELECT * FROM entities WHERE id = ?').get(id)", filename: CALLER },
      ],
      invalid: [
        {
          code: "db.$client.prepare('DELETE FROM entity_grants WHERE user_id = ?').run(id)",
          filename: CALLER,
          errors: [{ messageId: 'rawSql' }],
        },
        {
          code: 'sqlite.prepare(`UPDATE entities SET seq = seq + 1`).run()',
          filename: CALLER,
          errors: [{ messageId: 'rawSql' }],
        },
      ],
    });
  });
});

describe('no-direct-world-writes', () => {
  const rule = nudgeWrites.rules['no-direct-world-writes'];

  it('bans writes to `worlds` and `world_members` outside WorldWrites', () => {
    tester.run('no-direct-world-writes', rule, {
      valid: [
        { code: 'db.select().from(worlds).where(x).get()', filename: CALLER },
        { code: 'db.select({ userId }).from(worldMembers).all()', filename: CALLER },
        // `world_links` carries no `seq`: a link revoke emits directly, it does not bump a World.
        { code: 'db.delete(worldLinks).where(x).run()', filename: CALLER },
        // The Entity tables are the *other* rule's business.
        { code: 'db.update(entities).set(x).where(y).run()', filename: CALLER },
        // WorldWrites *is* the write handle, so it may write them — including its raw upserts.
        { code: 'this.db.update(worlds).set({ seq }).where(x).run()', filename: WORLD_OWNER },
        { code: 'this.db.delete(worldMembers).where(x).run()', filename: WORLD_OWNER },
        {
          code: "db.$client.prepare(`INSERT INTO world_members (world_id) VALUES (?)`).run(id)",
          filename: WORLD_OWNER,
        },
      ],
      invalid: [
        // `bumpAndNudge`'s old shape: the seq bump nothing structural forced to fan out.
        {
          code: 'this.db.update(worlds).set({ seq: sql`seq + 1` }).where(x).run()',
          filename: CALLER,
          errors: [{ messageId: 'direct' }],
        },
        // The exact line admin.service used to purge a deleted user's memberships.
        {
          code: 'this.db.delete(worldMembers).where(eq(worldMembers.userId, id)).run()',
          filename: CALLER,
          errors: [{ messageId: 'direct' }],
        },
        {
          code: 'this.db.insert(worldMembers).values({ role }).run()',
          filename: CALLER,
          errors: [{ messageId: 'direct' }],
        },
        {
          code: 'this.db.delete(worlds).where(eq(worlds.id, id)).run()',
          filename: CALLER,
          errors: [{ messageId: 'direct' }],
        },
        // `mintWorld`'s old raw insert — the drizzle selector could never have seen it.
        {
          code: "sqlite.prepare(`INSERT INTO worlds (id, name) VALUES (?,?)`).run(id, name)",
          filename: CALLER,
          errors: [{ messageId: 'rawSql' }],
        },
        {
          code: "sqlite.prepare(`INSERT INTO world_members (world_id, user_id, role) VALUES (?,?,'owner')`).run(w, u)",
          filename: CALLER,
          errors: [{ messageId: 'rawSql' }],
        },
        // The Entity write handle is exempt from the Entity rule, not this one.
        {
          code: 'this.db.update(worlds).set({ seq }).where(x).run()',
          filename: ENTITY_OWNER,
          errors: [{ messageId: 'direct' }],
        },
      ],
    });
  });
});
