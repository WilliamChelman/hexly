/**
 * The Entity domain (ADR-0018/0019): the top-level thing a user owns. The single
 * Zod source of truth (ADR-0001) for the Entity model and its REST payloads. A
 * Hex Map is now an Entity of `type: 'hexmap'`.
 */

import { z } from 'zod';
import { emptyHexMap, hexMapSchema } from './hex/hex-map';

/** The format tag new saves write (ADR-0019); a schema-affecting extension change is a bump + migration. */
export const CONTENT_FORMAT = 'tiptap-v3';

/**
 * Formats a reader loads losslessly (ADR-0019 dual-read). Each bump is additive, so
 * every earlier version's docs round-trip untouched with no transform: `tiptap-v2`
 * added the `entityLink` node (ADR-0023); `tiptap-v3` added the callout/image/table/
 * taskList nodes, the highlight mark, and entityLink `display`/`heading` (ADR-0033).
 * Saves always write CONTENT_FORMAT.
 */
export const READABLE_CONTENT_FORMATS = [
  'tiptap-v1',
  'tiptap-v2',
  'tiptap-v3',
] as const;

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
 * The Entity's Metadata map (CONTEXT.md → Metadata), stored inside the document
 * JSON — no dedicated column (ADR-0033, #146). Mirrors Obsidian frontmatter on
 * import (`aliases` and every non-`tags` key) and carries Hexly provenance under
 * the reserved `hexly.` namespace (e.g. `hexly.sourcePath`). Optional so pre-import
 * bodies validate unchanged; the domain never interprets the values.
 */
export const metadataSchema = z.record(z.string(), z.unknown()).optional();

/**
 * The type-discriminated Entity body — what the `document` column holds
 * (ADR-0018): `{ type, content, ...typedPayload }`. A `note` adds no payload; a
 * `hexmap` spreads the hex grid alongside the Content. Discriminating on `type`
 * keeps each arm exhaustively known at compile time.
 */
export const entityBodySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('note'),
    content: contentSchema,
    metadata: metadataSchema,
  }),
  z.object({
    type: z.literal('hexmap'),
    content: contentSchema,
    metadata: metadataSchema,
    ...hexMapSchema.shape,
  }),
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

/** The reserved Metadata namespace (ADR-0033): Hexly provenance keys (`hexly.*`) that drive placement/typing on export and are stripped from author-facing frontmatter. Shared by the vault import/export pair so the strip prefix has one source of truth (#150). */
export const HEXLY_METADATA_PREFIX = 'hexly.';

/**
 * `.trim()` before `.min(1)` rejects whitespace-only names and strips surrounding whitespace
 * (issues #12, #15). Shared with the World name (ADR-0024). Bounded to 255 chars and free of
 * control characters and path separators (`/`, `\`): names flow unescaped into filesystem paths,
 * zip entry keys, and the vault-export `Content-Disposition` header, where a newline or slash
 * corrupts the output or throws (#150).
 */
export const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (s) => !/[\p{Cc}/\\]/u.test(s),
    'Name cannot contain control characters or slashes',
  );

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

/**
 * The normalization contract for Link Descriptors (#96, ADR-0023): the distinct
 * relationship labels ("spouse", "capital of") an Entity's links use. The server
 * harvests them from the saved Content ({@link harvestDescriptors}) and runs them
 * through this — trimmed, lower-cased, deduped, blanks rejected, exactly like
 * {@link tagsSchema} — so the owner vocabulary folds case the same way. Defaults to
 * empty so a linkless doc yields an (empty) set, which replace-on-save then prunes.
 */
export const descriptorsSchema = dedupedTags.default([]);

/** POST /entities: body (Content + payload) is minted server-side. */
export const createEntityRequestSchema = z.object({
  name: nameSchema,
  type: entityTypeSchema,
  tags: tagsSchema,
  // Optional target World (ADR-0024): when omitted the server defaults to the owner's World (#101).
  worldId: z.string().optional(),
});

export type CreateEntityRequest = z.infer<typeof createEntityRequestSchema>;

/** PUT /entities/:id (ADR-0018): stale `version` is rejected with 409 (ADR-0004). */
export const saveEntityRequestSchema = z.object({
  document: entityBodySchema,
  version: z.number().int().nonnegative(),
  // Tags ride the version-checked save (#72): always the full current set, so a
  // save replaces the stored tags — an empty array clears them.
  tags: dedupedTags,
});

export type SaveEntityRequest = z.infer<typeof saveEntityRequestSchema>;

/** Entity Visibility (ADR-0024): `private` is owner-only; `shared` exposes the Entity to all World members. Replaces the retired `public` value — sharing is per-World now. */
export const visibilitySchema = z.enum(['private', 'shared']);

/** CONTEXT.md → Entity Visibility. */
export type Visibility = z.infer<typeof visibilitySchema>;

/**
 * The closed set of actions a caller may exercise on an Entity (CONTEXT.md → Rights,
 * ADR-0039). Each verb maps to an ADR-0037 access predicate: `read` (canRead), `edit`
 * (substance — content/name/tags/metadata), `delete` and `set-visibility` (the lifecycle
 * gate — Owner or World Owner of a shared Entity), `manage` (owners/grants/Public Link —
 * Owner only). Reported *with* the Entity so a surface gates its controls on exactly what
 * the server enforces, never re-deriving standing.
 */
export const entityVerbSchema = z.enum(['read', 'edit', 'delete', 'set-visibility', 'manage']);

/** CONTEXT.md → Rights (Entity). */
export type EntityVerb = z.infer<typeof entityVerbSchema>;

/**
 * PATCH /entities/:id: a metadata patch (ADR-0037) — the `name` and/or the Visibility,
 * no `version` (outside the document's concurrency check). At least one field must be
 * present. Visibility rides here so an Owner can flip `private`↔`shared` without a
 * document round-trip — a toggle straight from the Entity Browser (#160).
 */
export const patchEntityRequestSchema = z
  .object({
    name: nameSchema.optional(),
    visibility: visibilitySchema.optional(),
  })
  .refine((p) => p.name !== undefined || p.visibility !== undefined, {
    message: 'A patch must change at least one field',
  });

export type PatchEntityRequest = z.infer<typeof patchEntityRequestSchema>;

/**
 * Entity-level grant roles (ADR-0037, #161): `editor` may edit the Entity's substance
 * (Content, name, Tags, Metadata) but never its lifecycle or exposure; `viewer` is
 * read-only. Owner is excluded — it belongs to the ownership-set endpoints, not grants.
 */
export const grantRoleSchema = z.enum(['editor', 'viewer']);

/** CONTEXT.md → Editor / Viewer. */
export type GrantRole = z.infer<typeof grantRoleSchema>;

/**
 * An entity-level grant (ADR-0037, #161): a named Instance user (member of the World or
 * not) holding Editor or Viewer access to one Entity. A grant pierces `private` — a
 * Viewer grant on a `private` Entity is per-user visibility.
 */
export interface EntityGrant {
  readonly userId: string;
  readonly role: GrantRole;
}

/**
 * POST /entities/:id/grants: grant an existing Instance user Editor or Viewer on the
 * Entity. Upsert — re-granting a different role updates it. Owner-only server-side.
 */
export const addGrantRequestSchema = z.object({
  userId: z.string().min(1),
  role: grantRoleSchema,
});

export type AddGrantRequest = z.infer<typeof addGrantRequestSchema>;

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
  // Facet params (#155): each repeats in the query string (`?tag=a&tag=b`) and
  // combines OR within its category, AND across categories, all AND-ed with `q`.
  // A single occurrence arrives as a string, repeats as an array — normalize both
  // to an array, like `ids`. `type` is likewise repeatable now (multi-select rail).
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
  // Scope the list to one World (ADR-0024) — the entity browser's active-World filter.
  worldId: z.string().min(1).optional(),
  cursor: z.string().optional(),
  // Opt-in per-row Rights (ADR-0039): the Entity Browser sets `rights=1` to gate per-card
  // actions; suggestion/palette/export paths omit it so `list` stays a pure read-filter.
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

/** One Facet value and how many entities carry it under the active filters (#155). */
export interface FacetCount {
  readonly value: string;
  readonly count: number;
}

/**
 * `GET /entities/facets` (#155): each Facet category's live values with counts,
 * for the Facet rail. Counts drill down — every category is computed against all
 * *other* active constraints (query + the other Facets) but not its own, so a
 * category still lists the sibling values you could add. Zero-count values are omitted.
 */
export interface EntityFacets {
  readonly type: readonly FacetCount[];
  readonly tag: readonly FacetCount[];
  readonly visibility: readonly FacetCount[];
}

/** What `GET /entities` lists; body fetched only on open. `type`/`tags` ride along for grouping and filtering. */
export interface EntitySummary {
  readonly id: string;
  /** The World this Entity belongs to (ADR-0024). Every Entity belongs to exactly one. */
  readonly worldId: string;
  readonly name: string;
  readonly type: EntityType;
  readonly tags: readonly string[];
  readonly visibility: Visibility;
  /** The optimistic-concurrency counter; a save must carry this base value. */
  readonly version: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  /**
   * The caller's Rights on this Entity (ADR-0039), present only when the list request opted
   * in (`rights=1`) — the Entity Browser gates per-card actions on it. Absent on the default
   * read-filter path (suggestions, Command Palette, export), which never pays the per-row cost.
   */
  readonly rights?: readonly EntityVerb[];
}

/** What `GET /entities/:id` and saves return. */
export interface EntityDetail extends EntitySummary {
  readonly document: EntityBody;
  /**
   * The World's Home Entity (ADR-0024): can't be deleted or moved, and its title
   * is the World's name (ADR-0029) — renamed via the World, read-only on its own
   * page. Absent/false for every ordinary Entity.
   */
  readonly isHome?: boolean;
  /**
   * The caller's Rights on this Entity (CONTEXT.md → Rights, ADR-0039): the closed verb set
   * they may exercise, computed on read from the ADR-0037 predicates. Present and non-empty on
   * the single-entity fetch (`GET /entities/:id`) and anonymous link reads — an Owner gets all
   * five, an entity-level Editor `read`+`edit`, an anonymous link `read`. Absent on the
   * create/save/patch responses (the server computes Rights only on read); the client carries
   * the load-time Rights forward across an in-place mutation. Inherited optional (EntitySummary).
   */
  readonly rights?: readonly EntityVerb[];
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
