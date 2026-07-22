import { Injectable } from '@nestjs/common';
import { EntityDocument } from '@hexly/domain';

/**
 * A committed Entity deletion, as a byte-owning subsystem needs to see it (ADR-0065). Carries the deleted
 * Entity's identity, its Type set, and its last document — enough for an Asset reaper to read the asset-ref
 * and take the orphaned bytes/thumbnail with it.
 */
export interface DeletedEntity {
  readonly id: string;
  readonly worldId: string;
  readonly types: readonly string[];
  readonly document: EntityDocument;
}

/** A side effect run once an Entity's deletion has committed — filesystem cleanup, never a DB write. */
export type EntityDeletionReaper = (deleted: DeletedEntity) => void;

/**
 * The post-commit deletion hook set (ADR-0065). {@link EntityWrites} owns the `entities` table but must not
 * learn what an Asset is; a byte-owning subsystem (`AssetsService`) registers a reaper here at startup and
 * `EntityWrites` fires them all after a single-Entity delete commits. This inverts the dependency — the
 * `assets` module imports the `entities` module, never the reverse — and keeps the write handle Asset-blind.
 *
 * Reapers run **post-commit**, not inside the delete transaction: a rolled-back delete must never take the
 * bytes with it, and content-addressed bytes are safely orphaned once their sole Entity (dedup guarantees
 * one per hash) is gone. Bulk deletes (World cascade, import reconcile) do not fire reapers — a World's whole
 * Asset folder is removed wholesale by `AssetsService.deleteWorld`.
 */
@Injectable()
export class EntityDeletionRegistry {
  private readonly reapers: EntityDeletionReaper[] = [];

  /** Register a reaper to run after each single-Entity deletion commits. Idempotent across startups. */
  register(reaper: EntityDeletionReaper): void {
    this.reapers.push(reaper);
  }

  /** Fire every registered reaper for a just-committed deletion. A reaper's throw must not mask the delete. */
  reap(deleted: DeletedEntity): void {
    for (const reaper of this.reapers) reaper(deleted);
  }
}
