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
 * A Hex Map stored as a single JSON document (ADR-0002). The relational columns
 * are the metadata the list view and access checks need; `document` holds the
 * whole map as JSON text. `version` is the optimistic-concurrency counter — a
 * save carries the base version it was built on and is rejected (409) if it has
 * since moved.
 */
export const maps = sqliteTable(
  'maps',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    visibility: text('visibility').notNull(),
    version: integer('version').notNull(),
    // The serialized Hex Map document (hexMapSchema), parsed/validated at the edge.
    document: text('document').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    // The list endpoint and every access check filter by owner.
    index('idx_maps_owner_id').on(table.ownerId),
  ]
);
