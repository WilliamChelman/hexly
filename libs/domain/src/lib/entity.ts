/**
 * The Entity domain (ADR-0018/0019): the top-level thing a user owns. The single
 * Zod source of truth (ADR-0001) for the Entity model and its REST payloads. A
 * Hex Map is now an Entity of `type: 'hexmap'`.
 */

import { z } from 'zod';
import { emptyHexMap, hexMapSchema } from './hex/hex-map';

/**
 * The opaque, format-tagged Content body every Entity carries (ADR-0019). The
 * `format` tag is the contract; the `snapshot` is editor-defined JSON the domain
 * never parses (`z.unknown()`), so it round-trips untouched.
 */
export const contentSchema = z.object({
  format: z.literal('tiptap-v1'),
  snapshot: z.unknown(),
});

/** An Entity's opaque, format-tagged rich-text body (CONTEXT.md → Content). */
export type Content = z.infer<typeof contentSchema>;

/**
 * The closed, code-known set of Entity shapes (ADR-0018): `note` is Content
 * only; `hexmap` adds the hex grid. Only a *typed payload* (like the grid)
 * justifies a new type — mere flavour is a `tag`. User/plugin types are a
 * long-term goal, deliberately not built now.
 */
export const entityTypeSchema = z.enum(['note', 'hexmap']);

/** An Entity's structural type (CONTEXT.md → Entity Type). */
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

/** An Entity's stored body: its Content plus any type-specific payload. */
export type EntityBody = z.infer<typeof entityBodySchema>;

/** A fresh, empty Content envelope: the smallest valid TipTap document. */
export function emptyContent(): Content {
  return { format: 'tiptap-v1', snapshot: { type: 'doc', content: [] } };
}

/**
 * A brand-new body for an Entity of `type`: empty Content plus, for a `hexmap`,
 * an empty grid. The one place that knows the per-type empty payload.
 */
export function emptyEntityBody(type: EntityType): EntityBody {
  return type === 'hexmap'
    ? { type, content: emptyContent(), ...emptyHexMap() }
    : { type, content: emptyContent() };
}

/**
 * An Entity name. `.trim()` before `.min(1)` rejects whitespace-only names and
 * strips surrounding whitespace before it's persisted (issues #12, #15).
 */
const nameSchema = z.string().trim().min(1);

/**
 * Free-text Tags on an Entity (CONTEXT.md → Tag). Defaults to empty so an Entity
 * created or stored without tags still lists with an array rather than
 * `undefined`. Tags carry no behaviour — distinct from the structured type.
 */
export const tagsSchema = z.array(z.string()).default([]);

/**
 * The body of `POST /entities`: a new Entity needs a name and a type; tags
 * default to empty and the body (Content + payload) is minted server-side.
 */
export const createEntityRequestSchema = z.object({
  name: nameSchema,
  type: entityTypeSchema,
  tags: tagsSchema,
});

/** A validated create submission for an Entity. */
export type CreateEntityRequest = z.infer<typeof createEntityRequestSchema>;

/**
 * The body of `PATCH /entities/:id`: rename an Entity. Metadata-only — no body
 * and no base `version`, so a rename is outside the document's concurrency check.
 */
export const renameEntityRequestSchema = z.object({ name: nameSchema });

/** A validated rename submission for an Entity. */
export type RenameEntityRequest = z.infer<typeof renameEntityRequestSchema>;

/**
 * The body of `PUT /entities/:id`: the whole Entity body (ADR-0018) plus the
 * base `version` it was built on; a stale base is rejected with 409 (ADR-0004).
 */
export const saveEntityRequestSchema = z.object({
  document: entityBodySchema,
  version: z.number().int().nonnegative(),
});

/** A validated save submission for an Entity. */
export type SaveEntityRequest = z.infer<typeof saveEntityRequestSchema>;

/**
 * Who can reach an Entity. `private` is owner-only; `public` exposes the
 * read-only link (ADR-0004). Stored as metadata; the public-link endpoint is a
 * later issue, so nothing acts on it yet.
 */
export const visibilitySchema = z.enum(['private', 'public']);

/** An Entity's visibility (CONTEXT.md → Public Link). */
export type Visibility = z.infer<typeof visibilitySchema>;

/**
 * An Entity without its body: the metadata `GET /entities` lists. The body is
 * fetched only on open; `type`/`tags` ride along so a list can group and filter.
 */
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

/** An Entity with its full body: what `GET /entities/:id` and saves return. */
export interface EntityDetail extends EntitySummary {
  readonly document: EntityBody;
}

/**
 * The save outcome the client observes: the stored Entity at its new version,
 * or a 409 conflict carrying the server's current Entity to re-pull (ADR-0018).
 */
export type EntitySaveOutcome =
  | { status: 'saved'; entity: EntityDetail }
  | { status: 'conflict'; current: EntityDetail };
