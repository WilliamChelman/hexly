/**
 * The Entity domain: the top-level thing a user owns. What an Entity *is* — a note, a
 * map, a monster — is its **Entity Type** set, an open one the core does not enumerate:
 * a type declares **Fields**, and nothing here knows what any of them hold.
 */

import * as z from 'zod';
import { FieldDataType, EntityDocument } from './field';
import { kindedIdRegex } from './kinded-id';

/**
 * A single Entity Type identity (CONTEXT.md → Entity Type): an **open**,
 * `namespace.type.name`-keyed string (`core.type.note`, `dnd.type.monster`, `world.type.deity`) —
 * plugins and Worlds extend the set, so this validates only the *shape* of an id, never an
 * enumerated value.
 */
export const entityTypeSchema = z
  .string()
  .trim()
  .regex(kindedIdRegex('type'), 'An Entity Type must be a `namespace.type.name` key');

/** CONTEXT.md → Entity Type. Open set, so widened to `string`. */
export type EntityType = z.infer<typeof entityTypeSchema>;

/**
 * The ordered, deduped set of Entity Types an Entity carries (CONTEXT.md → Entity
 * Type): `types[0]` is *primary* (drives icon, default view, headline). At least one —
 * every Entity has a primary type. Deduping preserves the authored order.
 */
export const typesSchema = z
  .array(entityTypeSchema)
  .min(1)
  .transform((types) => [...new Set(types)]);

/**
 * The **Entity Document** (CONTEXT.md → Entity Document): the one open key→value map that is an
 * Entity's whole authored substance — what the `document` column holds. There is no wrapper and no
 * second store (ADR-0051): everything a Type adds is a **Field** over one of its keys, a Field of a
 * plugin's **Structured Data Type** (a grid, prose) included. Mirrors Obsidian frontmatter on import;
 * Hexly provenance lives under the reserved `hexly.` namespace.
 *
 * A record of `unknown`, never closed: a Field value that does not inhabit its data-type is left
 * alone, never rejected, so a document at rest this build cannot parse opens rather than 500ing.
 * Forward-only validation ({@link validateFields}) is the only gate, and it runs on active typed
 * edits alone.
 */
export const entityDocumentSchema = z.record(z.string(), z.unknown());

/** The reserved Entity Document namespace: Hexly provenance keys (`hexly.*`) that drive placement/typing on export and are stripped from author-facing frontmatter. */
export const HEXLY_METADATA_PREFIX = 'hexly.';

/**
 * A copy of `doc` with every reserved `hexly.*` key removed — the shape a **user-facing** write may
 * persist. The reserved namespace is system-owned provenance (import stamps, source paths, ADR-0060);
 * a user's create/save seed can neither forge nor overwrite it, so it is stripped on the way in while
 * the system writes that mint it are untouched.
 */
export function stripReservedKeys(doc: EntityDocument): EntityDocument {
  return Object.fromEntries(Object.entries(doc).filter(([key]) => !key.startsWith(HEXLY_METADATA_PREFIX)));
}

/** The reserved `hexly.*` subset of `doc` — the system-owned provenance a user edit must preserve, not drop (ADR-0060). */
export function reservedKeys(doc: EntityDocument): EntityDocument {
  return Object.fromEntries(Object.entries(doc).filter(([key]) => key.startsWith(HEXLY_METADATA_PREFIX)));
}

/**
 * The reserved key a vault export stamps an Entity's ordered Type set under, and import reads back
 * — no author document key records the types.
 */
export const HEXLY_TYPE_KEY = `${HEXLY_METADATA_PREFIX}type`;

/**
 * `.trim()` before `.min(1)` rejects whitespace-only names. Shared with the World
 * name. Bounded to 255 chars and free of control characters and path separators:
 * names flow unescaped into filesystem paths, zip entry keys, and the vault-export
 * download-disposition header, where a newline or slash corrupts the output.
 */
export const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((s) => !/[\p{Cc}/\\]/u.test(s), 'Name cannot contain control characters or slashes');

/**
 * One free-text label as a *vocabulary* stores it: trimmed, lower-cased, blanks rejected.
 * Both a Tag and the `::` Link Descriptor vocabulary fold through it, so `"Spouse"` and
 * `" spouse "` are one value in either.
 */
const normalizedLabel = z.string().trim().toLowerCase().min(1);

const dedupedTags = z.array(normalizedLabel).transform((tags) => [...new Set(tags)]);

export const tagsSchema = dedupedTags.default([]);

/**
 * A single Link Descriptor ("spouse", "Capital Of") **as authored**: trimmed, blanks
 * rejected, case preserved. Not folded — a prose link renders this exact string in the
 * document, so the edge index that mirrors it must too, or one link would show two spellings
 * of its descriptor on one screen. Folding is a property of the vocabulary
 * ({@link descriptorsSchema}), not of the descriptor itself.
 */
export const descriptorSchema = z.string().trim().min(1);

/**
 * Link Descriptors — the distinct relationship labels ("spouse", "capital of") an Entity's
 * links use — case-folded like {@link tagsSchema}. A linkless doc yields an empty set,
 * which replace-on-save then prunes.
 */
export const descriptorsSchema = dedupedTags.default([]);

/** POST /entities: the body is minted server-side from `types` — the defaults their Fields declare. */
export const createEntityRequestSchema = z.object({
  name: nameSchema,
  // The ordered type set; `types[0]` is primary. One or more per creation (ADR-0048).
  types: typesSchema,
  tags: tagsSchema,
  // Initial Entity Document values seeded into the minted body — what the create dialog collected for
  // a picked type's required Fields. Merged over the server-minted defaults; omitted → a blank map.
  document: entityDocumentSchema.optional(),
  // Optional target World; omitted, the server defaults to the owner's World.
  worldId: z.string().optional(),
});

export type CreateEntityRequest = z.infer<typeof createEntityRequestSchema>;

/**
 * POST /entities/:id/adopt: **Adoption** (CONTEXT.md → Adoption, ADR-0079) — copy a **Compendium
 * Entry** into a World as an ordinary, editable Entity. The body carries the target alone; everything
 * else about the copy is read off the entry.
 *
 * The World is required rather than defaulted to the caller's oldest, unlike a create's: adoption is
 * always asked for from a surface that already names one — the `:worldId` the **Compendium browse** was
 * read under, which is the adoption target and not the content's home.
 */
export const adoptEntityRequestSchema = z.object({
  worldId: z.string().min(1),
});

export type AdoptEntityRequest = z.infer<typeof adoptEntityRequestSchema>;

/** PUT /entities/:id: stale `version` is rejected with 409. */
export const saveEntityRequestSchema = z.object({
  document: entityDocumentSchema,
  version: z.number().int().nonnegative(),
  // Always the full current set — a save replaces the stored tags; an empty array clears them.
  tags: dedupedTags,
  // Optional: a save replaces the type set when present, and leaves it untouched when omitted.
  // Multi-type authoring is not surfaced yet, so the current client omits it (ADR-0048).
  types: typesSchema.optional(),
  // Attached Fields ride the document itself (ADR-0057): a directly-attached Field is a namespaced key the
  // document carries that no type defaults, so there is no separate attachment set to send.
});

export type SaveEntityRequest = z.infer<typeof saveEntityRequestSchema>;

/** Entity Visibility: `private` is owner-only; `shared` exposes the Entity to all World members. */
export const visibilitySchema = z.enum(['private', 'shared']);

/** CONTEXT.md → Entity Visibility. */
export type Visibility = z.infer<typeof visibilitySchema>;

/**
 * The closed set of actions a caller may exercise on an Entity (CONTEXT.md →
 * Rights): `read`, `edit` (substance — body/name/tags), `delete` and
 * `set-visibility` (the lifecycle gate — Owner or World Owner of a shared Entity),
 * `manage` (owners/grants/Public Link — Owner only).
 */
export const entityVerbSchema = z.enum(['read', 'edit', 'delete', 'set-visibility', 'manage']);

/** CONTEXT.md → Rights (Entity). */
export type EntityVerb = z.infer<typeof entityVerbSchema>;

/**
 * PATCH /entities/:id: a metadata patch — the `name` **or** the Visibility, never both, and no
 * `version` (outside the document's concurrency check). The two are different write kinds with
 * different gates: a rename is substance, which an entity-level Editor may make; a Visibility flip
 * is exposure, which needs full write rights (ADR-0039, ADR-0045).
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
 * CONTEXT.md → Link-target read. `link-target` returns no **Compendium Entry**; `navigation` does,
 * ranked below authored Entities. Declared by the surface, so one rule serves all four link-target
 * ones. Defaults to `navigation` — the seal is held by discovery, not by an invariant (ADR-0079).
 */
export const entityReadSchema = z.enum(['navigation', 'link-target']);

export type EntityRead = z.infer<typeof entityReadSchema>;

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
  // The **Container** scope, repeatable — how a read that spans Containers names them (ADR-0079): the
  // Compendium browse lists every installed pack, so it says which ones rather than riding the
  // single-Container scoping every World read uses. `worldId` above is that same scope under the name a
  // World-scoped caller knows it by; both fold into one predicate server-side.
  containerId: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
  // Facet: the **Compendium** facet's selection — a narrowing *within* the scope above, so it drills
  // down like Type or Tag (dropped when counting its own values) rather than redefining what the read
  // is about. Nothing outside the scope can be reached by naming it here: both predicates AND.
  compendium: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
  // Defaulted rather than optional, so an unknown value is a 400: a typo'd `read=linktarget` must not
  // silently navigate.
  read: entityReadSchema.default('navigation'),
  cursor: z.string().optional(),
  // Opt-in per-row Rights; paths that omit it keep `list` a pure read-filter.
  rights: z
    .string()
    .optional()
    .transform((v) => v === '1' || v === 'true'),
  // Opt-in per-row thumbnail URL (ADR-0065): the Asset Browser sets it; other lists skip the join.
  thumbnails: z
    .string()
    .optional()
    .transform((v) => v === '1' || v === 'true'),
  // Opt-in: keep hidden-from-default-listing types (ADR-0065) in the result set — the exclusion is a
  // *browse* rule, so the by-name pickers ask for them explicitly and a `q` alone no longer lifts it.
  includeHidden: z
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
 * A facetable **Field** (or a structured Data Type's harvested dimension, ADR-0055) as a facet: the
 * `key` it surfaces under, its human `label` and `dataType` (the rail picks a data-type-appropriate
 * control — value toggles for enum/list/string, a range for number/date), and its live `values` with
 * counts. Surfaced **by presence** (#231) — a Field facet appears whenever the current result set
 * carries values for its key, whatever types those Entities hold.
 *
 * `labelKey` is set only when the facet comes from a harvested dimension (ADR-0055): its i18n key, so
 * the rail renders the label translated in the active Locale. A scalar Field leaves it unset — its
 * `label` is an authored string, not a translation key.
 *
 * `valuesKeyPrefix` is the matching i18n key prefix for the dimension's enum VALUES (ADR-0055/0065): a
 * client resolves each `FacetCount.value` as `<valuesKeyPrefix>.<value>`, falling back to the raw token.
 * Unset for a scalar Field, whose values are authored data and render verbatim.
 */
export interface FieldFacet {
  readonly key: string;
  readonly label: string;
  readonly labelKey?: string;
  readonly valuesKeyPrefix?: string;
  readonly dataType: FieldDataType;
  readonly values: readonly FacetCount[];
}

/**
 * `GET /entities/facets`: each Facet category's live values with counts. Counts
 * drill down — every category is computed against all *other* active constraints
 * but not its own, so a category still lists the sibling values you could add.
 * Zero-count values are omitted. The universal facets (`type`/`tag`/`visibility`)
 * are always present; `fields` carries a Field facet for every key the current
 * result set carries values for (#231), whatever types those Entities hold.
 */
export interface EntityFacets {
  readonly type: readonly FacetCount[];
  readonly tag: readonly FacetCount[];
  readonly visibility: readonly FacetCount[];
  readonly fields: readonly FieldFacet[];
  /**
   * The **Compendium** facet (ADR-0079): which pack each entry came from, `value` the Container id and
   * `label` its name. Surfaced *by presence* like a Field facet — a read that names a single Container
   * has nothing to narrow, so only a cross-Container read (the Compendium browse) carries it.
   */
  readonly compendium?: readonly FacetCount[];
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
  /**
   * The served thumbnail URL (ADR-0065), present only when the list opted in (`thumbnails=1`) and the
   * Entity carries content-addressed bytes in the dedup index — the Asset Browser's tile source. Derived
   * generically from the `(worldId, hash)` index, so it names no type; it falls back to the original on
   * the serving route when no thumbnail was minted, so it is always safe to use as a tile `src`.
   */
  readonly thumbnailUrl?: string;
  /**
   * Set when this Entity's own bytes are absent from the resolved Assets root (#325, ADR-0034). Computed per
   * read, so restoring the file clears it with no Reindex; absent for an Entity that owns no bytes.
   */
  readonly assetBytesMissing?: boolean;
  /**
   * Set when this Entity is **Sealed** (CONTEXT.md → Sealed): it lives in a **Compendium**, so it is
   * read-only to everyone and nothing outside its Compendium may point at it. Derived from where the
   * Entity lives, never stored — there is no flag on the row to set or to forge (ADR-0079).
   *
   * The read side of the seal the client needs: it is why {@link rights} says `read` alone, why the
   * World segment in the entry's URL is navigation context rather than its home, and what an
   * **Adoption** affordance keys off.
   */
  readonly sealed?: boolean;
}

/** What `GET /entities/:id` and saves return. */
export interface EntityDetail extends EntitySummary {
  /** The Entity body — the EntityDocument map itself (ADR-0051). */
  readonly document: EntityDocument;
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
 * One page of summaries plus an opaque cursor clients pass back as `cursor` for the next
 * page; `nextCursor` is `null` on the final page. The cursor's encoding is server-only —
 * clients never construct or inspect it.
 */
export interface EntityPage {
  readonly items: EntitySummary[];
  readonly nextCursor: string | null;
}

/** Saved at the new version, or a 409 conflict carrying the server's current Entity to re-pull. */
export type EntitySaveOutcome =
  | { status: 'saved'; entity: EntityDetail }
  | { status: 'conflict'; current: EntityDetail };
