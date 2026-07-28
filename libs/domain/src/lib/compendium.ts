import { CompendiumAttribution } from './importer';

/**
 * One installed pack as `GET /compendiums` lists it (CONTEXT.md → Compendium): the Container's identity
 * plus what its satellite records — the **Compendium Importer** that owns it, the pinned `rev`, and its
 * attribution.
 *
 * Readable by any signed-in caller, like the entries themselves: a Compendium is Instance-wide and has
 * no members (ADR-0078), so there is nothing per-caller to resolve. This is the list the Compendium
 * browse names its Containers from, and the row a pack's own page renders its terms off (#402).
 */
export interface CompendiumSummary {
  /** The Container id — what an entry's `worldId` carries, and what the browse names as a Container. */
  readonly id: string;
  /** The pack's authored name, as its Importer declared it on install ("Draw Steel: Monsters"). */
  readonly name: string;
  readonly importer: string;
  /** The revision the pack is pinned at (ADR-0061) — "which version of the bestiary is this". */
  readonly rev: string;
  /** Absent parts stay absent, so a pack that recorded no terms renders no empty scaffold (#402). */
  readonly attribution: CompendiumAttribution;
  readonly createdAt: number;
  readonly updatedAt: number;
}
