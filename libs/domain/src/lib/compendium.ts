import { CompendiumAttribution, ImportRunSummary } from './importer';

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

/**
 * What the operator's pack panel knows about a pack that is actually on the shelf (ADR-0079, #404):
 * the Container it installed and the revision it is pinned at, so "which version of the bestiary is
 * this" is answerable without opening an entry. Absent until a first run has landed one.
 */
export interface InstalledPack {
  /** The **Compendium** Container's id. */
  readonly id: string;
  /** The pack's name as its Importer declared it on install ("Draw Steel: Monsters"). */
  readonly name: string;
  /** The pinned source revision the shelf reflects (ADR-0061). */
  readonly rev: string;
  /** How many entries the shelf currently holds. */
  readonly entryCount: number;
  /** When the pack was last installed or reimported. */
  readonly updatedAt: number;
}

/**
 * One compendium pack as the operator's admin panel lists it (ADR-0079, #404). A pack *is* a
 * **Compendium Importer**, so the Importer's id is what install, reimport and removal key on — the
 * Container only exists once a run has landed one. Instance-wide, so there is no World anywhere in
 * this shape: the shelf is uniform, and installing it once serves every World.
 */
export interface CompendiumPackSummary {
  /** The **Compendium Importer**'s id — the handle every operator route keys on. */
  readonly importer: string;
  /** The Importer's transloco key for the panel, or its id when it ships none (renders untranslated). */
  readonly label: string;
  /** Absent until a run has installed the pack; present with its pinned revision once one has. */
  readonly installed?: InstalledPack;
  /** Where this pack's one run stands — `idle` before any this process has seen. The panel's poll target. */
  readonly run: ImportRunSummary;
}
