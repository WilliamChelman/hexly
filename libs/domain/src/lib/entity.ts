/**
 * The Entity domain (ADR-0018/0019): the top-level thing a user owns. The single
 * Zod source of truth (ADR-0001) for the Entity model and its REST payloads. A
 * Hex Map is now an Entity of `type: 'hexmap'`.
 */

import { z } from 'zod';
import { emptyHexMap, hexMapSchema } from './hex/hex-map';

/** The format tag new saves write (ADR-0019); a schema-affecting extension change is a bump + migration. */
export const CONTENT_FORMAT = 'tiptap-v2';

/**
 * Formats a reader loads losslessly (ADR-0023 dual-read). `tiptap-v2` is additive
 * over `tiptap-v1` (it adds the `entityLink` node), so a v1 doc simply has none and
 * round-trips untouched — no transform either way. Saves always write CONTENT_FORMAT.
 */
export const READABLE_CONTENT_FORMATS = ['tiptap-v1', 'tiptap-v2'] as const;

/** Opaque, format-tagged Content (ADR-0019). `snapshot` is `z.unknown()` — the domain never parses it. */
export const contentSchema = z.object({
  format: z.enum(READABLE_CONTENT_FORMATS),
  snapshot: z.unknown(),
});

export type Content = z.infer<typeof contentSchema>;

/** The one place a snapshot becomes Content — keeps the editor seam from hand-stamping the format tag (ADR-0019). */
export function tiptapContent(snapshot: unknown): Content {
  return { format: CONTENT_FORMAT, snapshot };
}

/**
 * The closed, code-known set of Entity shapes (ADR-0018): `note` is Content
 * only; `hexmap` adds the hex grid. Only a *typed payload* (like the grid)
 * justifies a new type — mere flavour is a `tag`. User/plugin types are a
 * long-term goal, deliberately not built now.
 */
export const entityTypeSchema = z.enum(['note', 'hexmap']);

/** CONTEXT.md → Entity Type. */
export type EntityType = z.infer<typeof entityTypeSchema>;

/**
 * The type-discriminated Entity body — what the `document` column holds
 * (ADR-0018): `{ type, content, ...typedPayload }`. A `note` adds no payload; a
 * `hexmap` spreads the hex grid alongside the Content. Discriminating on `type`
 * keeps each arm exhaustively known at compile time.
 */
export const entityBodySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('note'), content: contentSchema }),
  z.object({ type: z.literal('hexmap'), content: contentSchema, ...hexMapSchema.shape }),
]);

export type EntityBody = z.infer<typeof entityBodySchema>;

export function emptyContent(): Content {
  return tiptapContent({ type: 'doc', content: [] });
}

/** The one place that knows the per-type empty payload. */
export function emptyEntityBody(type: EntityType): EntityBody {
  return type === 'hexmap'
    ? { type, content: emptyContent(), ...emptyHexMap() }
    : { type, content: emptyContent() };
}

/** `.trim()` before `.min(1)` rejects whitespace-only names and strips surrounding whitespace (issues #12, #15). */
const nameSchema = z.string().trim().min(1);

/**
 * Free-text Tags on an Entity (CONTEXT.md → Tag), normalized on parse so the
 * schema — not just the UI — owns what a tag is (ADR-0001): trimmed, lower-cased
 * (folds "Deity"/"deity"; chips render uppercase regardless), blanks rejected
 * (#88), duplicates collapsed. Defaults to empty so a tagless Entity still lists
 * with an array.
 */
const dedupedTags = z
  .array(z.string().trim().toLowerCase().min(1))
  .transform((tags) => [...new Set(tags)]);

export const tagsSchema = dedupedTags.default([]);

/** POST /entities: body (Content + payload) is minted server-side. */
export const createEntityRequestSchema = z.object({
  name: nameSchema,
  type: entityTypeSchema,
  tags: tagsSchema,
});

export type CreateEntityRequest = z.infer<typeof createEntityRequestSchema>;

/** PATCH /entities/:id: metadata-only — no `version`, so a rename is outside the document's concurrency check. */
export const renameEntityRequestSchema = z.object({ name: nameSchema });

export type RenameEntityRequest = z.infer<typeof renameEntityRequestSchema>;

/** PUT /entities/:id (ADR-0018): stale `version` is rejected with 409 (ADR-0004). */
export const saveEntityRequestSchema = z.object({
  document: entityBodySchema,
  version: z.number().int().nonnegative(),
  // Tags ride the version-checked save (#72): always the full current set, so a
  // save replaces the stored tags — an empty array clears them.
  tags: dedupedTags,
});

export type SaveEntityRequest = z.infer<typeof saveEntityRequestSchema>;

/** The list page size default and server-enforced cap (ADR-0025). Over-cap requests are clamped, not rejected. */
export const ENTITY_LIST_DEFAULT_LIMIT = 50;
export const ENTITY_LIST_MAX_LIMIT = 200;

/**
 * `GET /entities` query params (ADR-0025), validated at the boundary (ADR-0001).
 * All optional and composable: `ids` selects an explicit owner-scoped set, `q`
 * filters by case-insensitive name match, `type` by Entity Type, `cursor` is the
 * opaque page token, `limit` bounds the page. A malformed `limit` is a 400; an
 * over-cap `limit` is clamped. `cursor` is only shape-checked here — its decode
 * (and the 400 for a malformed one) is server-internal.
 */
export const entityListQuerySchema = z.object({
  // A query param arrives as a string for one value, an array for repeats.
  ids: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
  q: z.string().optional(),
  type: entityTypeSchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .transform((n) => Math.min(n, ENTITY_LIST_MAX_LIMIT))
    .default(ENTITY_LIST_DEFAULT_LIMIT),
});

export type EntityListQuery = z.infer<typeof entityListQuerySchema>;

/** `private` is owner-only; `public` exposes the read-only link (ADR-0004). Stored as metadata; the public-link endpoint is a later issue, so nothing acts on it yet. */
export const visibilitySchema = z.enum(['private', 'public']);

/** CONTEXT.md → Public Link. */
export type Visibility = z.infer<typeof visibilitySchema>;

/** What `GET /entities` lists; body fetched only on open. `type`/`tags` ride along for grouping and filtering. */
export interface EntitySummary {
  readonly id: string;
  readonly ownerId: string;
  readonly name: string;
  readonly type: EntityType;
  readonly tags: readonly string[];
  readonly visibility: Visibility;
  /** The optimistic-concurrency counter; a save must carry this base value. */
  readonly version: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** What `GET /entities/:id` and saves return. */
export interface EntityDetail extends EntitySummary {
  readonly document: EntityBody;
}

/**
 * One page of the entities read surface (ADR-0025): summaries only, plus an
 * opaque {@link cursor} clients pass back as `cursor` to fetch the next page.
 * `nextCursor` is `null` on the final page. The cursor's internal encoding is
 * server-only — clients never construct or inspect it.
 */
export interface EntityPage {
  readonly items: EntitySummary[];
  readonly nextCursor: string | null;
}

/** Saved at the new version, or a 409 conflict carrying the server's current Entity to re-pull (ADR-0018). */
export type EntitySaveOutcome =
  | { status: 'saved'; entity: EntityDetail }
  | { status: 'conflict'; current: EntityDetail };
