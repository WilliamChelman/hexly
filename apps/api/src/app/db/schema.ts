import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
});
