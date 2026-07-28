import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CompendiumDeclaration } from '@hexly/domain';
import { eq, sql } from 'drizzle-orm';
import { DB, Db } from '../db/db';
import { COMPENDIUM_CONTAINER_KIND, compendiums, containers } from '../db/schema';
import { SyncOnly, WriteOutbox } from '../events/write-outbox';
import { compendiumByImporter } from './compendiums';

/**
 * The single write handle for a **Compendium** — its `containers` identity row (ADR-0078) and its
 * `compendiums` satellite (ADR-0079). The {@link WorldWrites} peer: it owns the `seq` bump and the
 * post-commit nudge, and an ESLint rule bans `insert|update|delete(containers)` and `(compendiums)`
 * everywhere but the two handles.
 *
 * Deliberately *not* a method on `WorldWrites`. That handle bumps a World's `seq` and fans membership
 * out to the World's `shared` Entities; a Compendium has no membership to fan out and no World
 * satellite to write, so folding it in would mean a nullable World threaded through six methods that
 * are World-shaped for a reason (ADR-0078: Collaboration stays World-only).
 */
@Injectable()
export class CompendiumWrites {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly outbox: WriteOutbox,
  ) {}

  /** Run `fn` in the outermost transaction, flushing the nudge outbox on commit. */
  transact<T>(fn: () => SyncOnly<T>): T {
    return this.outbox.transact(fn);
  }

  /**
   * Install a pack, or re-capture it on reimport: mint the Container and its satellite on the first
   * run, else refresh the pinned `rev`, the name and the attribution the Importer now declares.
   * Returns the Container id the reconcile lands into.
   *
   * The pack's terms are captured *here*, from the Importer's declaration, rather than read out of the
   * plugin at render time — so a page showing them (#402) reads one row, and a pack whose plugin is
   * later disabled still states the terms its content was published under (ADR-0061).
   */
  install(importer: string, declaration: CompendiumDeclaration, rev: string, now: number = Date.now()): string {
    const attribution = declaration.attribution ?? {};
    return this.transact(() => {
      const existing = compendiumByImporter(this.db, importer);
      const id = existing?.id ?? randomUUID();
      if (!existing) {
        this.db
          .insert(containers)
          .values({ id, kind: COMPENDIUM_CONTAINER_KIND, name: declaration.name, createdAt: now, updatedAt: now })
          .run();
        this.db.insert(compendiums).values({ id, importer, rev, ...pickAttribution(attribution) }).run();
      } else {
        this.db
          .update(containers)
          .set({ name: declaration.name, updatedAt: now, seq: sql`${containers.seq} + 1` })
          .where(eq(containers.id, id))
          .run();
        this.db
          .update(compendiums)
          .set({ rev, ...pickAttribution(attribution) })
          .where(eq(compendiums.id, id))
          .run();
      }
      // No nudge on the mint: nothing can be following an id that did not exist a moment ago. A
      // reimport's refresh does nudge — a browse live-following the shelf re-reads its revision.
      if (existing) this.outbox.world(id);
      return id;
    });
  }

  /**
   * Uninstall a pack: drop its Container, taking the satellite (and so the recorded revision and
   * attribution) with it. The entries are the caller's to delete first — the reconcile removes them in
   * yielding chunks, and the `entities.container_id` FK is what makes forgetting that loud rather than
   * silent.
   */
  uninstall(id: string): void {
    this.transact(() => {
      this.db.delete(containers).where(eq(containers.id, id)).run();
      this.outbox.world(id);
    });
  }
}

/** The attribution columns as a patch — absent parts written as NULL, so a re-capture can clear a term. */
function pickAttribution(attribution: { publisher?: string; license?: string; notice?: string }) {
  return {
    publisher: attribution.publisher ?? null,
    license: attribution.license ?? null,
    notice: attribution.notice ?? null,
  };
}
