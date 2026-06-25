import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// This Drizzle definition and the `CREATE TABLE` DDL in `./db.ts` describe the
// same tables and are kept in sync by hand. A column change needs a migration
// (drizzle-kit) to reach an existing database, not just an edit here.

/**
 * The closed user set (ADR-0004). Users are provisioned out-of-band — there is
 * no signup — so this table only ever grows via the seed mechanism. The
 * password is stored as an argon2 hash; the plaintext never touches the row.
 */
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at').notNull(),
});

/**
 * Server-side sessions: the cookie carries only the opaque `id` (token); this
 * row is the source of truth. Logout deletes the row, so revocation is
 * immediate (ADR-0004 — logout ends the session).
 */
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [
    // Speeds up the expired-session sweep that runs on every login.
    index('idx_sessions_expires_at').on(table.expiresAt),
  ]
);

/**
 * An Entity stored as a single JSON document (ADR-0018, ADR-0002). The columns
 * are the metadata the list view and access checks need; `document` holds the
 * whole type-discriminated body as JSON. `type`/`tags` are denormalized out so
 * a list can group/filter without loading each body. `version` is the
 * optimistic-concurrency counter (a stale save is a 409). A Hex Map is an
 * Entity of `type: 'hexmap'` (replaces the `maps` table — migration in `db.ts`).
 */
export const entities = sqliteTable(
  'entities',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    // The closed Entity type enum (note | hexmap), validated at the edge.
    type: text('type').notNull(),
    // Free-text tags as a JSON array; `mode: 'json'` serializes on the way in.
    tags: text('tags', { mode: 'json' }).$type<string[]>().notNull(),
    visibility: text('visibility').notNull(),
    version: integer('version').notNull(),
    // The serialized Entity body (entityBodySchema), parsed/validated at the edge.
    document: text('document').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    // The list endpoint and every access check filter by owner.
    index('idx_entities_owner_id').on(table.ownerId),
  ]
);
