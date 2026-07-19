/**
 * The Importer seam and its **Import Source** provenance (CONTEXT.md → Import; ADR-0060). A Plugin
 * contributes an {@link Importer} — a near-pure producer that fetches an external source and transforms
 * it into {@link ImportRecord}s — through {@link ServerPlugin.importers}. A generic framework reconcile
 * (a later story) matches Records to existing Entities by `(importer, sourceId)`, upserts, and stamps
 * each with an {@link ImportSource} under the reserved {@link HEXLY_SOURCE_KEY} document key. This module
 * owns only the vocabulary and the single reader of that key; the reconcile and the write choke point
 * that mirrors it to the derived `entityImportSource` index live host-side.
 */

import { z } from 'zod';
import { EntityType, HEXLY_METADATA_PREFIX, visibilitySchema } from './entity';
import { EntityDocument } from './field';

/**
 * The reserved Entity Document key an Entity's **Import Source** lives under (CONTEXT.md → Import
 * Source): the provenance the Importer that produced it stamps. A plain `hexly.*` value — inert when
 * the owning Plugin is absent — and the source of truth the derived `entityImportSource` index mirrors.
 */
export const HEXLY_SOURCE_KEY = `${HEXLY_METADATA_PREFIX}source`;

/**
 * The provenance an imported Entity carries (CONTEXT.md → Import Source): which `importer` owns it, its
 * stable upstream `sourceId`, and the pinned source `rev` it reflects. Validated forward-only — a
 * document whose `hexly.source` does not inhabit this shape reads as un-stamped, never rejected
 * (ADR-0060, like the rest of the Entity Document).
 */
export const importSourceSchema = z.object({
  importer: z.string().min(1),
  sourceId: z.string().min(1),
  rev: z.string().min(1),
});

/** CONTEXT.md → Import Source. */
export type ImportSource = z.infer<typeof importSourceSchema>;

/**
 * Read an Entity Document's **Import Source**, or `undefined` when it carries none or an ill-shaped one.
 * The single reader the write choke point and Reindex derive the `entityImportSource` index through, so
 * an absent or malformed stamp materialises no provenance row rather than throwing (ADR-0060).
 */
export function readImportSource(doc: EntityDocument | undefined): ImportSource | undefined {
  const raw = doc?.[HEXLY_SOURCE_KEY];
  if (raw === undefined || raw === null) return undefined;
  const parsed = importSourceSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/**
 * An **Importer**'s unit of output (CONTEXT.md → Import Record): everything the framework needs to mint
 * or update one Entity, and nothing about *how* it lands. The reconcile matches Records to existing
 * Entities by `(importer, sourceId)` and upserts, stamping each with the {@link ImportSource} it derives
 * from the owning Importer's id, this `sourceId`, and the run's pinned revision (ADR-0060).
 */
export interface ImportRecord {
  /** The stable upstream id — the match key for the reconcile's identity-preserving upsert. */
  readonly sourceId: string;
  readonly name: string;
  /** The ordered Entity Type set to mint the Entity under; `types[0]` is primary. */
  readonly types: readonly EntityType[];
  /** The Entity Document to write, sans provenance — the framework stamps `hexly.source`, not the Importer. */
  readonly document: EntityDocument;
}

/**
 * What the framework hands an Importer's {@link Importer.produce}. Deliberately minimal — an Importer
 * only fetches and transforms (ADR-0060); the reconcile owns the database, provenance, and the choke
 * point. A cancelled run aborts the fetch through `signal`.
 */
export interface ImportContext {
  readonly signal?: AbortSignal;
}

/**
 * One {@link Importer.produce} run's whole output: the {@link ImportRecord}s to reconcile, and the
 * pinned source `rev` they all reflect. The `rev` is a run property, not a per-Record one — the
 * Importer resolves it once (the tarball version it fetched, ADR-0061) — and the reconcile stamps it
 * into every landed Entity's {@link ImportSource}, since a Record deliberately carries no provenance.
 */
export interface ImportProduction {
  /** The pinned source revision this run reflects — the `rev` every stamped {@link ImportSource} carries. */
  readonly rev: string;
  readonly records: readonly ImportRecord[];
}

/**
 * A code-registered producer that turns an external source into Entities (CONTEXT.md → Importer). A
 * Plugin contributes one by `namespace.id` through {@link ServerPlugin.importers}; it only fetches and
 * transforms, yielding an {@link ImportProduction}, and never touches the database, provenance, or the
 * write choke point — the framework's reconcile does (ADR-0060). This makes a plugin's import path a
 * near-pure function that is trivially fixture-tested.
 */
export interface Importer {
  /** This Importer's `namespace.id` — the `importer` an {@link ImportSource} names (`draw-steel.monsters`). */
  readonly id: string;
  /**
   * The Importer's human copy for the generic Imports panel (CONTEXT.md → Importer). Optional — the
   * panel falls back to the {@link id} — so a Plugin adds an Importer by shipping a `produce()` alone.
   */
  readonly label?: string;
  /** Fetch and transform the source into an {@link ImportProduction}; the reconcile lands it. */
  produce(ctx: ImportContext): Promise<ImportProduction>;
}

/**
 * One Importer as the generic Imports panel lists it (CONTEXT.md → Importer): its `id` and the copy to
 * show. The reconcile's `list` surface returns whatever Importers the enabled Plugins registered for a
 * World — no per-Importer route or chrome.
 */
export interface ImporterSummary {
  readonly id: string;
  readonly label: string;
}

/** The body of `POST /worlds/:worldId/importers/:importerId/run`: the {@link Visibility} landed Entities take. */
export const runImportRequestSchema = z.object({ visibility: visibilitySchema }).strict();

/** A validated import-run request. */
export type RunImportRequest = z.infer<typeof runImportRequestSchema>;

/**
 * The stable reasons the per-World Importer surface refuses a run — distinct from the vault
 * `ImportErrorCode` (that gates a `.zip` upload; this gates a plugin Importer reconcile). Returned as
 * `{ code }` in the 4xx body.
 */
export const ImporterErrorCode = {
  /** A run is already reconciling this World — one at a time, so a second is a 409 (ADR-0060). */
  ImportRunning: 'import-running',
} as const;

/** One of the {@link ImporterErrorCode} values. */
export type ImporterErrorCode = (typeof ImporterErrorCode)[keyof typeof ImporterErrorCode];

/**
 * One Import Record the reconcile could not land — its transform was ill-shaped (no name, no types) —
 * skipped and tallied so a single bad Record never aborts the run (CONTEXT.md → Import Record). Its
 * upstream `sourceId` is *not* treated as vanished, so a still-present-but-malformed Record keeps its
 * existing Entity rather than deleting it.
 */
export interface ImportSkip {
  /** The Record's upstream id, or the empty string when the Record lacked even that. */
  readonly sourceId: string;
  /** What about the Record made it unlandable — surfaced verbatim for the panel. */
  readonly reason: string;
}

/**
 * Where a World's one import run stands. `idle` is the state before any run this process has seen;
 * `succeeded` means the reconcile finished, even if it skipped Records (see {@link ImportRunSummary.skipped}).
 * `failed` is reserved for a run that *aborted* — the Importer's fetch threw or the database refused,
 * never a single bad Record.
 */
export type ImportRunStatus = 'idle' | 'running' | 'succeeded' | 'failed';

/**
 * A World's import run (ADR-0060) — the generic, importer-agnostic reconcile of an Importer's
 * {@link ImportProduction} into one World. `POST …/run` starts it and returns at once (202); the
 * matching `GET …/import/status` polls. Only ever one per World: a second run while one is in flight
 * is a 409. Job state lives in the API process, not the DB — a restart forgets an unfinished run whose
 * done chunks are already on disk (like the Reindex, ADR-0046).
 *
 * `created + updated` is the Records landed; `deleted` the Entities whose `sourceId` vanished upstream;
 * `skipped` the ill-shaped Records, with reasons.
 */
export interface ImportRunSummary {
  /** Which Importer this run reconciles, or null before any run (idle). */
  readonly importer: string | null;
  /**
   * The pinned source revision this run reflects (the {@link ImportProduction.rev} its Importer
   * resolved) — the same `rev` every landed Entity's {@link ImportSource} carries. Null until the run
   * has fetched (idle, or a run that failed in its fetch); the generic Imports panel shows it in the
   * last-run status line so "which revision is this set?" is answerable without loading a document.
   */
  readonly rev: string | null;
  readonly status: ImportRunStatus;
  /** Records the reconcile will process — the produced total minus the skipped, the denominator for progress. */
  readonly total: number;
  readonly created: number;
  readonly updated: number;
  readonly deleted: number;
  readonly skipped: readonly ImportSkip[];
  readonly startedAt: number | null;
  readonly finishedAt: number | null;
  /** Set only when `status === 'failed'`: why the run aborted. */
  readonly error: string | null;
}
