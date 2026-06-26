/**
 * The Entity domain (ADR-0018/0019): the top-level thing a user owns. The single
 * Zod source of truth (ADR-0001) for the Entity model and its REST payloads. A
 * Hex Map is now an Entity of `type: 'hexmap'`.
 */

import { z } from 'zod';
import { emptyHexMap, hexMapSchema } from './hex/hex-map';

/** Single source for the format tag (ADR-0019); a schema-affecting extension change is a bump + migration. */
export const CONTENT_FORMAT = 'tiptap-v1';

/** Opaque, format-tagged Content (ADR-0019). `snapshot` is `z.unknown()` — the domain never parses it. */
export const contentSchema = z.object({
  format: z.literal(CONTENT_FORMAT),
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

/** Saved at the new version, or a 409 conflict carrying the server's current Entity to re-pull (ADR-0018). */
export type EntitySaveOutcome =
  | { status: 'saved'; entity: EntityDetail }
  | { status: 'conflict'; current: EntityDetail };
