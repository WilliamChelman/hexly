import { eq, getTableColumns } from 'drizzle-orm';
import { Db } from '../db/db';
import { CompendiumRow, compendiums, containers } from '../db/schema';

/**
 * The whole-Compendium read (ADR-0079), the peer of `world-access.ts`'s `selectWorld`: the Container's
 * identity columns beside its satellite's own. Driven off `compendiums`, never `containers` — the
 * satellite *is* the "this is a Compendium" discriminator, so no `kind` filter is needed here or
 * anywhere else (ADR-0078).
 *
 * Deliberately unguarded by an access context: a Compendium is Instance-wide and has no members, no
 * roles and no public link (ADR-0078), so unlike a World there is nothing per-caller to resolve.
 */
export function selectCompendium(db: Db) {
  return db
    .select({
      ...getTableColumns(containers),
      importer: compendiums.importer,
      rev: compendiums.rev,
      publisher: compendiums.publisher,
      license: compendiums.license,
      notice: compendiums.notice,
    })
    .from(compendiums)
    .innerJoin(containers, eq(containers.id, compendiums.id));
}

/**
 * The Compendium a **Compendium Importer** owns, or undefined before its first successful run. One
 * per pack — `compendiums.importer` is unique — so this answers "where does this Importer land?" with
 * exactly one Container.
 */
export function compendiumByImporter(db: Db, importer: string): CompendiumRow | undefined {
  return selectCompendium(db).where(eq(compendiums.importer, importer)).get();
}
