import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { PublicLink } from '@hexly/domain';
import { Db } from '../db/db';

/**
 * A Public-Link table (`world_links` / `entity_links`, ADR-0037, #162): an unguessable token
 * as primary key (`id`), keyed to one target by a foreign key, at most one active row per
 * target. The get / mint / revoke logic is identical across the two link surfaces — only the
 * table, its FK, and the ownership gate differ — so it lives here once, parameterized, and each
 * service supplies its own gate around these calls.
 */
export interface PublicLinkTable {
  readonly table: SQLiteTable;
  /** The token column (primary key). */
  readonly id: SQLiteColumn;
  /** The target foreign-key column (`world_id` / `entity_id`). */
  readonly fk: SQLiteColumn;
  /** Build one insert row — the FK's TS key differs per table, so callers spell it out. */
  readonly newRow: (token: string, targetId: string) => Record<string, unknown>;
}

/** The target's active Public Link token, or null when none is minted. */
export function readPublicLink(db: Db, link: PublicLinkTable, targetId: string): PublicLink | null {
  const row = db.select({ id: link.id }).from(link.table).where(eq(link.fk, targetId)).get();
  return row ? { token: String(row.id) } : null;
}

/**
 * Mint (or return the existing) Public Link for the target: one active link per target, so a
 * re-mint returns the current token rather than rotating it (rotate = revoke + re-mint), keeping
 * the shared URL stable. The token is an anonymous Viewer grant that pierces `private` (ADR-0004).
 */
export function mintPublicLink(db: Db, link: PublicLinkTable, targetId: string): PublicLink {
  const existing = readPublicLink(db, link, targetId);
  if (existing) return existing;
  // ponytail: no unique index on the FK — a concurrent double-mint could race two rows.
  // Harmless on a ~5-user instance; add a unique index if that ever matters.
  const token = randomUUID();
  db.insert(link.table).values(link.newRow(token, targetId)).run();
  return { token };
}

/** Revoke the target's Public Link — the kill-switch; idempotent (no row is a no-op). */
export function revokePublicLink(db: Db, link: PublicLinkTable, targetId: string): void {
  db.delete(link.table).where(eq(link.fk, targetId)).run();
}
