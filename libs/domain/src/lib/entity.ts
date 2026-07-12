/**
 * The Entity domain: the top-level thing a user owns. The single Zod source of
 * truth for the Entity model and its REST payloads. A Hex Map is an Entity that
 * carries the `core.hexmap` type — the type that declares the grid as a **Structured
 * Field**, so its plane is a Metadata value like any other (ADR-0050).
 */

import { z } from 'zod';
import { FieldDataType } from './field';

/** The format tag new saves write; a schema-affecting extension change is a bump + migration. */
export const CONTENT_FORMAT = 'tiptap-v3';

/**
 * Formats a reader loads losslessly. Each bump is additive, so every earlier
 * version's docs round-trip untouched with no transform. Saves always write
 * CONTENT_FORMAT.
 */
export const READABLE_CONTENT_FORMATS = ['tiptap-v1', 'tiptap-v2', 'tiptap-v3'] as const;

/** Format-tagged Content; `snapshot` is `z.unknown()` so persistence stays format-agnostic — see ADR-0019. */
export const contentSchema = z.object({
  format: z.enum(READABLE_CONTENT_FORMATS),
  snapshot: z.unknown(),
});

export type Content = z.infer<typeof contentSchema>;

/** The one place a snapshot becomes Content — keeps callers from hand-stamping the format tag. */
export function tiptapContent(snapshot: unknown): Content {
  return { format: CONTENT_FORMAT, snapshot };
}

/**
 * A single Entity Type identity (CONTEXT.md → Entity Type): an **open**,
 * `namespace.id`-keyed string (`core.note`, `core.hexmap`, `dnd.monster`) — plugins and
 * Worlds extend the set — so this validates only the *shape* of an id, never an
 * enumerated value.
 */
export const entityTypeSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/, 'An Entity Type must be a `namespace.id` key');

/** CONTEXT.md → Entity Type. Open set, so widened to `string`. */
export type EntityType = z.infer<typeof entityTypeSchema>;

/** The two core Entity Types, registered by the core the same way a plugin would (ADR-0048). */
export const CORE_NOTE = 'core.note';
export const CORE_HEXMAP = 'core.hexmap';

/**
 * The ordered, deduped set of Entity Types an Entity carries (CONTEXT.md → Entity
 * Type): `types[0]` is *primary* (drives icon, default view, headline). At least
 * one — every Entity has a primary type. `Set` insertion order preserves the
 * authored order while collapsing duplicates.
 */
export const typesSchema = z
  .array(entityTypeSchema)
  .min(1)
  .transform((types) => [...new Set(types)]);

/**
 * The Entity's Metadata map (CONTEXT.md → Metadata), stored inside the document
 * JSON. Mirrors Obsidian frontmatter on import; Hexly provenance lives under the
 * reserved `hexly.` namespace. Optional so pre-import bodies validate unchanged;
 * the domain never interprets the values.
 */
export const metadataSchema = z.record(z.string(), z.unknown()).optional();

/**
 * The Entity body — what the `document` column holds. One shape, for every Entity: Content plus
 * Metadata (ADR-0050). Everything a Type adds to an Entity's substance is a **Field** over a Metadata
 * key, a Hex Map's grid included, so the body needs no discriminant and no registry to parse.
 *
 * `.strict()` because the body root is closed: an unknown key there is a document this build cannot
 * represent (a pre-collapse Hex Map, with its grid at the root), and reading it as a note that has
 * silently lost its map would be worse than failing loudly. Tolerance lives one level down, in the
 * data: a Field value that does not inhabit its data-type is left alone, never rejected.
 */
export const entityBodySchema = z
  .object({
    content: contentSchema,
    metadata: metadataSchema,
  })
  .strict();

export type EntityBody = z.infer<typeof entityBodySchema>;

export function emptyContent(): Content {
  return tiptapContent({ type: 'doc', content: [] });
}

/** The reserved Metadata namespace: Hexly provenance keys (`hexly.*`) that drive placement/typing on export and are stripped from author-facing frontmatter. */
export const HEXLY_METADATA_PREFIX = 'hexly.';

/**
 * `.trim()` before `.min(1)` rejects whitespace-only names. Shared with the World
 * name. Bounded to 255 chars and free of control characters and path separators:
 * names flow unescaped into filesystem paths, zip entry keys, and the vault-export
 * `Content-Disposition` header, where a newline or slash corrupts the output.
 */
export const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((s) => !/[\p{Cc}/\\]/u.test(s), 'Name cannot contain control characters or slashes');

/**
 * Free-text Tags on an Entity (CONTEXT.md → Tag), normalized on parse so the
 * schema — not just the UI — owns what a tag is: trimmed, lower-cased, blanks
 * rejected, duplicates collapsed. Defaults to empty so a tagless Entity still
 * lists with an array.
 */
/**
 * One free-text label as a *vocabulary* stores it: trimmed, lower-cased, blanks
 * rejected. The single definition a Tag and the `::` Link Descriptor vocabulary
 * fold through, so `"Spouse"` and `" spouse "` are one value in both.
 */
const normalizedLabel = z.string().trim().toLowerCase().min(1);

const dedupedTags = z.array(normalizedLabel).transform((tags) => [...new Set(tags)]);

export const tagsSchema = dedupedTags.default([]);

/**
 * A single Link Descriptor ("spouse", "Capital Of") **as authored**: trimmed, blanks
 * rejected, case preserved. Deliberately *not* folded — a Content link renders this
 * exact string in the prose, so the edge index that mirrors it must too, or one link
 * would show two spellings of its descriptor on one screen. Folding is a property of
 * the vocabulary ({@link descriptorsSchema}), not of the descriptor itself.
 */
export const descriptorSchema = z.string().trim().min(1);

/**
 * Link Descriptors — the distinct relationship labels ("spouse", "capital of")
 * an Entity's links use — normalized exactly like {@link tagsSchema} so the
 * owner vocabulary folds case the same way. Defaults to empty so a linkless doc
 * yields an (empty) set, which replace-on-save then prunes.
 */
export const descriptorsSchema = dedupedTags.default([]);

/** POST /entities: the body is minted server-side from `types` — blank Content plus their Fields' defaults. */
export const createEntityRequestSchema = z.object({
  name: nameSchema,
  // The ordered type set; `types[0]` is primary. One or more per creation (ADR-0048).
  types: typesSchema,
  tags: tagsSchema,
  // Initial Metadata seeded into the minted body — the values the create dialog collected for a
  // picked type's required Fields. Omitted → a blank map.
  metadata: metadataSchema,
  // Optional target World; omitted, the server defaults to the owner's World.
  worldId: z.string().optional(),
});

export type CreateEntityRequest = z.infer<typeof createEntityRequestSchema>;

/** PUT /entities/:id: stale `version` is rejected with 409. */
export const saveEntityRequestSchema = z.object({
  document: entityBodySchema,
  version: z.number().int().nonnegative(),
  // Always the full current set — a save replaces the stored tags; an empty array clears them.
  tags: dedupedTags,
  // Optional: a save replaces the type set when present, and leaves it untouched when omitted.
  // Multi-type authoring is not surfaced yet, so the current client omits it (ADR-0048).
  types: typesSchema.optional(),
});

export type SaveEntityRequest = z.infer<typeof saveEntityRequestSchema>;

/** Entity Visibility: `private` is owner-only; `shared` exposes the Entity to all World members. */
export const visibilitySchema = z.enum(['private', 'shared']);

/** CONTEXT.md → Entity Visibility. */
export type Visibility = z.infer<typeof visibilitySchema>;

/**
 * The closed set of actions a caller may exercise on an Entity (CONTEXT.md →
 * Rights): `read`, `edit` (substance — content/name/tags/metadata), `delete` and
 * `set-visibility` (the lifecycle gate — Owner or World Owner of a shared Entity),
 * `manage` (owners/grants/Public Link — Owner only). Reported *with* the Entity so
 * a surface gates its controls on exactly what the server enforces, never
 * re-deriving standing.
 */
export const entityVerbSchema = z.enum(['read', 'edit', 'delete', 'set-visibility', 'manage']);

/** CONTEXT.md → Rights (Entity). */
export type EntityVerb = z.infer<typeof entityVerbSchema>;

/**
 * PATCH /entities/:id: a metadata patch — the `name` **or** the Visibility, never both, and no
 * `version` (outside the document's concurrency check).
 *
 * The two are different write kinds with different gates: a rename is substance, which an
 * entity-level Editor may make; a Visibility flip is exposure, which needs full write rights
 * (ADR-0039, ADR-0045). Accepting both in one request forced the *caller* to decide which rule
 * judged it. Requiring exactly one lets the kind name the change and the kind pick the gate.
 */
export const patchEntityRequestSchema = z
  .object({
    name: nameSchema.optional(),
    visibility: visibilitySchema.optional(),
  })
  .refine((p) => (p.name !== undefined) !== (p.visibility !== undefined), {
    message: 'A patch must change exactly one of `name` or `visibility`',
  });

export type PatchEntityRequest = z.infer<typeof patchEntityRequestSchema>;

/**
 * Entity-level grant roles: `editor` may edit the Entity's substance but never
 * its lifecycle or exposure; `viewer` is read-only. Owner is excluded — it
 * belongs to the ownership-set endpoints, not grants.
 */
export const grantRoleSchema = z.enum(['editor', 'viewer']);

/** CONTEXT.md → Editor / Viewer. */
export type GrantRole = z.infer<typeof grantRoleSchema>;

/**
 * A named Instance user (World member or not) holding Editor or Viewer access to
 * one Entity. A grant pierces `private` — a Viewer grant on a `private` Entity is
 * per-user visibility.
 */
export interface EntityGrant {
  readonly userId: string;
  readonly role: GrantRole;
}

/**
 * POST /entities/:id/grants. Upsert — re-granting a different role updates it.
 * Owner-only server-side.
 */
export const addGrantRequestSchema = z.object({
  userId: z.string().min(1),
  role: grantRoleSchema,
});

export type AddGrantRequest = z.infer<typeof addGrantRequestSchema>;

/** The list page size default and server-enforced cap. Over-cap requests are clamped, not rejected. */
export const ENTITY_LIST_DEFAULT_LIMIT = 50;
export const ENTITY_LIST_MAX_LIMIT = 200;

/**
 * `GET /entities` query params, all optional and composable. Facet params
 * (`type`/`tag`/`visibility`) repeat in the query string (`?tag=a&tag=b`) and
 * combine OR within a category, AND across categories, all AND-ed with `q`.
 * A malformed `limit` is a 400; an over-cap `limit` is clamped. `cursor` is only
 * shape-checked here — its decode is server-internal.
 */
export const entityListQuerySchema = z.object({
  // A query param arrives as a string for one value, an array for repeats — normalize to an array.
  ids: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
  q: z.string().optional(),
  type: z
    .union([entityTypeSchema, z.array(entityTypeSchema)])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
  tag: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
  visibility: z
    .union([visibilitySchema, z.array(visibilitySchema)])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
  // Filter-by-Field (ADR-0048, #188): each repeated `field` param is a `key:op:value` token
  // (`challenge_rating:gte:5`, `alignment:eq:lawful-good`). Only shape-normalised to an array here;
  // the domain `parseFieldFilters` decodes the tokens (a malformed one is dropped, never a 400).
  field: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
  worldId: z.string().min(1).optional(),
  cursor: z.string().optional(),
  // Opt-in per-row Rights; paths that omit it keep `list` a pure read-filter.
  rights: z
    .string()
    .optional()
    .transform((v) => v === '1' || v === 'true'),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .transform((n) => Math.min(n, ENTITY_LIST_MAX_LIMIT))
    .default(ENTITY_LIST_DEFAULT_LIMIT),
});

export type EntityListQuery = z.infer<typeof entityListQuerySchema>;

/**
 * One Facet value and how many entities carry it under the active filters. `label` is a display
 * rendering shown in place of the raw `value` — set for an Entity-Link Field facet, whose `value`
 * is a target id and `label` its current name (absent when the target dangles); unset elsewhere,
 * where the value is already human-readable (#188, #190).
 */
export interface FacetCount {
  readonly value: string;
  readonly count: number;
  readonly label?: string;
}

/**
 * One type's facetable **Field** as a facet (ADR-0048, #188): the Metadata `key` it types, its
 * human `label` and `dataType` (so the rail picks a data-type-appropriate control — value toggles
 * for enum/list/string, a range for number/date), and its live `values` with counts. Surfaced
 * **contextually** — a Field facet appears only once its type is in the active Type filter.
 */
export interface FieldFacet {
  readonly key: string;
  readonly label: string;
  readonly dataType: FieldDataType;
  readonly values: readonly FacetCount[];
}

/**
 * `GET /entities/facets`: each Facet category's live values with counts. Counts
 * drill down — every category is computed against all *other* active constraints
 * but not its own, so a category still lists the sibling values you could add.
 * Zero-count values are omitted. The universal facets (`type`/`tag`/`visibility`)
 * are always present; `fields` carries a type's Field facets only while that type
 * is the active filter, so the rail stays clean (ADR-0048, #188).
 */
export interface EntityFacets {
  readonly type: readonly FacetCount[];
  readonly tag: readonly FacetCount[];
  readonly visibility: readonly FacetCount[];
  readonly fields: readonly FieldFacet[];
}

/** What `GET /entities` lists; body fetched only on open. */
export interface EntitySummary {
  readonly id: string;
  /** Every Entity belongs to exactly one World. */
  readonly worldId: string;
  readonly name: string;
  /** The ordered Entity Type set; `types[0]` is primary (CONTEXT.md → Entity Type). */
  readonly types: readonly EntityType[];
  readonly tags: readonly string[];
  readonly visibility: Visibility;
  /** The optimistic-concurrency counter; a save must carry this base value. */
  readonly version: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  /** The caller's Rights, present only when the list request opted in (`rights=1`). */
  readonly rights?: readonly EntityVerb[];
}

/** What `GET /entities/:id` and saves return. */
export interface EntityDetail extends EntitySummary {
  readonly document: EntityBody;
  /**
   * The live-follow freshness key (ADR-0045): bumped by every committed change. A follower keeps
   * the highest `seq` it has seen and refetches only on a nudge that exceeds it. Distinct from
   * `version`, which the client sends back on save and which never moves on a sharing change.
   */
  readonly seq: number;
  /**
   * The caller's Rights, computed on read. Present and non-empty on the
   * single-entity fetch and anonymous link reads; absent on create/save/patch
   * responses — the client carries load-time Rights across in-place mutations.
   */
  readonly rights?: readonly EntityVerb[];
}

/**
 * One page of summaries plus an opaque {@link cursor} clients pass back as
 * `cursor` for the next page; `nextCursor` is `null` on the final page. The
 * cursor's encoding is server-only — clients never construct or inspect it.
 */
export interface EntityPage {
  readonly items: EntitySummary[];
  readonly nextCursor: string | null;
}

/** Saved at the new version, or a 409 conflict carrying the server's current Entity to re-pull. */
export type EntitySaveOutcome =
  | { status: 'saved'; entity: EntityDetail }
  | { status: 'conflict'; current: EntityDetail };
