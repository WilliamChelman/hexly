/**
 * The persistence contracts for a Hex Map (issue #6, ADR-0002): the REST
 * payloads the API and web client exchange to list, create, load, and save
 * maps. The document itself is {@link hexMapSchema}; these schemas wrap it with
 * the relational metadata (id, owner, title, visibility, version, timestamps)
 * and carry the base `version` that drives optimistic concurrency. As with the
 * rest of `libs/domain`, the Zod schema is the single source of truth — both
 * runtimes validate against it (ADR-0001).
 */

import { z } from 'zod';
import { HexMap, hexMapSchema } from './hex/hex-map';

/**
 * Who can reach a Hex Map. `private` is owner-only; `public` exposes the
 * read-only link (ADR-0004). Stored as metadata now; the public-link endpoint
 * itself is a later issue, so nothing yet acts on `public`.
 */
export const visibilitySchema = z.enum(['private', 'public']);

/** A Hex Map's visibility (CONTEXT.md → Public Link). */
export type Visibility = z.infer<typeof visibilitySchema>;

/**
 * A map title as the server stores it. The `.trim()` transform runs before
 * `.min(1)`, so the parsed value is already trimmed (no leading/trailing
 * whitespace is persisted) and a whitespace-only title collapses to "" and is
 * rejected — closing the gap a bare `z.string().min(1)` left open (issues #12,
 * #15). Shared by create and rename so the rule is defined once.
 */
const titleSchema = z.string().trim().min(1);

/** The body of `POST /maps`: a new map needs a name; the rest has defaults. */
export const createMapRequestSchema = z.object({
  title: titleSchema,
});

/** A validated create submission for a Hex Map. */
export type CreateMapRequest = z.infer<typeof createMapRequestSchema>;

/**
 * The body of `PATCH /maps/:id`: rename a map. Metadata-only, so unlike a save
 * it carries no document and no base `version` — a rename touches a different
 * column than the document and must not be rejected by the document's
 * optimistic-concurrency check, nor advance it.
 */
export const renameMapRequestSchema = z.object({
  title: titleSchema,
});

/** A validated rename submission for a Hex Map. */
export type RenameMapRequest = z.infer<typeof renameMapRequestSchema>;

/**
 * A Hex Map without its document: the row metadata `GET /maps` lists. Cheap to
 * return many of — the document (potentially large) is fetched only on open.
 */
export interface MapSummary {
  readonly id: string;
  readonly ownerId: string;
  readonly title: string;
  readonly visibility: Visibility;
  /** The optimistic-concurrency counter; a save must carry this base value. */
  readonly version: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** A Hex Map with its full document: what `GET /maps/:id` and saves return. */
export interface MapDetail extends MapSummary {
  readonly document: HexMap;
}

/** The outcome of a save that the client observes: the stored map at its new version, or a 409 conflict carrying the server's current map (issue #6, ADR-0002). */
export type MapSaveOutcome =
  | { status: 'saved'; map: MapDetail }
  | { status: 'conflict'; current: MapDetail };

/**
 * The body of `PUT /maps/:id`: the whole document (ADR-0002 saves the document
 * in full) plus the `version` it was built on. The server compares that base
 * version against the stored one and rejects a stale save with 409, so two
 * editors can't silently overwrite each other (ADR-0004 — last-write-wins is
 * guarded by the version, not merged).
 */
export const saveMapRequestSchema = z.object({
  document: hexMapSchema,
  version: z.number().int().nonnegative(),
});

/** A validated save submission for a Hex Map. */
export type SaveMapRequest = z.infer<typeof saveMapRequestSchema>;
