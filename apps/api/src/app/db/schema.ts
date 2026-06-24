import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// SINGLE SOURCE OF SCHEMA INTENT: this Drizzle definition and the raw
// `CREATE TABLE` DDL in `./db.ts` describe the same tables and MUST be kept in
// sync by hand. Changing a column here does NOT migrate an existing database —
// a live schema change requires a migration (e.g. drizzle-kit), not just edits.

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
 * An Entity stored as a single JSON document (ADR-0018, extending ADR-0002).
 * The relational columns are the metadata the list view and access checks need;
 * `document` holds the whole type-discriminated body (`{ type, content,
 * ...payload }`) as JSON text. `type` and `tags` are denormalized out of the
 * body so a list can group/filter without loading each body. `version` is the
 * optimistic-concurrency counter — a save carries the base version it was built
 * on and is rejected (409) if it has since moved. A Hex Map is an Entity of
 * `type: 'hexmap'` (the `maps` table this replaces — see the migration in `db.ts`).
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
