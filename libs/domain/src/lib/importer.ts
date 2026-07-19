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
import { EntityType, HEXLY_METADATA_PREFIX } from './entity';
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
 * A code-registered producer that turns an external source into Entities (CONTEXT.md → Importer). A
 * Plugin contributes one by `namespace.id` through {@link ServerPlugin.importers}; it only fetches and
 * transforms, yielding {@link ImportRecord}s, and never touches the database, provenance, or the write
 * choke point — the framework's reconcile does (ADR-0060). This makes a plugin's import path a
 * near-pure function that is trivially fixture-tested.
 */
export interface Importer {
  /** This Importer's `namespace.id` — the `importer` an {@link ImportSource} names (`draw-steel.monsters`). */
  readonly id: string;
  /** Fetch and transform the source into Import Records; the reconcile lands them. */
  produce(ctx: ImportContext): Promise<readonly ImportRecord[]>;
}
