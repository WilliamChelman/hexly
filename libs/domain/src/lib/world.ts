/**
 * The World domain: a lightweight container record that groups Entities for one
 * campaign or setting. Not an Entity type — it lives outside the entity model
 * in its own table.
 */

import * as z from 'zod';
import { ENTITY_LIST_MAX_LIMIT, entityTypeSchema, nameSchema } from './entity';

/**
 * A World container (CONTEXT.md → World): a `name` and its `owners`. A World
 * never points back at an Entity (no circular FK) — the landing page is a
 * derived World Dashboard, not a stored Entity.
 */
export const worldSchema = z.object({
  id: z.string(),
  name: nameSchema,
  owners: z.array(z.string()),
});

/**
 * World membership roles: `owner` is the symmetric ownership set (full
 * control); `contributor` and `viewer` sit below it.
 */
export const worldRoleSchema = z.enum(['owner', 'contributor', 'viewer']);

/** CONTEXT.md → World Owner / Contributor / World Viewer. */
export type WorldRole = z.infer<typeof worldRoleSchema>;

/**
 * The closed set of actions a caller may exercise on a World (CONTEXT.md →
 * Rights): `read` (reachable), `create-entity` (World Owner or Contributor) and
 * `manage` (World Owner). A World has no substance to `edit`.
 *
 * `create-entity` is narrower than `manage` and wider than `read` — authoring an
 * Entity is not a World management power (ADR-0024) — so an Editor holding rights
 * on one Entity reaches its World without being able to create in it (ADR-0073).
 */
export const worldVerbSchema = z.enum(['read', 'create-entity', 'manage']);

/** CONTEXT.md → Rights (World). */
export type WorldVerb = z.infer<typeof worldVerbSchema>;

/**
 * The roles assignable through the membership endpoints: `contributor` (creates
 * Entities, reads `shared`) and `viewer` (reads `shared` only). `owner` is
 * excluded — it belongs to the ownership-set endpoints, not member management.
 */
export const memberRoleSchema = z.enum(['contributor', 'viewer']);

export type MemberRole = z.infer<typeof memberRoleSchema>;

/** A non-owner World member: an Instance user with a Contributor or Viewer role. */
export interface WorldMember {
  readonly userId: string;
  readonly role: MemberRole;
}

/** POST /worlds/:id/members: add an existing Instance user as a Contributor or Viewer. */
export const addMemberRequestSchema = z.object({
  userId: z.string().min(1),
  role: memberRoleSchema,
});

export type AddMemberRequest = z.infer<typeof addMemberRequestSchema>;

/** PATCH /worlds/:id/members/:userId: change a member's role between the two member roles. */
export const setMemberRoleRequestSchema = z.object({ role: memberRoleSchema });

export type SetMemberRoleRequest = z.infer<typeof setMemberRoleRequestSchema>;

/** POST /worlds: only the name is client-supplied; the World row is minted server-side. */
export const createWorldRequestSchema = z.object({ name: nameSchema });

export type CreateWorldRequest = z.infer<typeof createWorldRequestSchema>;

/**
 * PATCH /worlds/:id: the `name` and/or the ordered `pinnedEntityIds` set. Pins
 * are sent wholesale — add, remove, and reorder all collapse to "send the new
 * array". Ids are references, not enforced FKs: a stale or inaccessible id is
 * filtered per-viewer on read, never rejected here.
 */
export const updateWorldRequestSchema = z.object({
  name: nameSchema.optional(),
  // Deduped at the trust boundary: duplicate ids would resolve to duplicate Dashboard
  // cards and crash the `@for` track-by. Capped at the pin-resolve ceiling so the stored
  // set never exceeds what a single access-filtered read returns.
  pinnedEntityIds: z
    .array(z.string())
    .max(ENTITY_LIST_MAX_LIMIT)
    .transform((ids) => [...new Set(ids)])
    .optional(),
});

export type UpdateWorldRequest = z.infer<typeof updateWorldRequestSchema>;

/** Add an Owner to a World or Entity's ownership set; the target must be an existing Instance user. */
export const addOwnerRequestSchema = z.object({ userId: z.string().min(1) });

export type AddOwnerRequest = z.infer<typeof addOwnerRequestSchema>;

/** What a World read surface returns — the stored record plus its timestamps. */
export interface WorldSummary {
  readonly id: string;
  readonly name: string;
  /** The World's ownership set: one or more equal Owner user ids. */
  readonly owners: readonly string[];
  /**
   * The caller's Rights: always present and non-empty — a reachable World
   * carries at least `read`, an Owner also `manage`.
   */
  readonly rights: readonly WorldVerb[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** A single World — what POST/GET/PATCH `/worlds/:id` return. */
export interface WorldDetail extends WorldSummary {
  /** How many Entities live in this World — the number a delete would destroy. */
  readonly entityCount: number;
  /**
   * The live-follow freshness key (ADR-0045), the peer of `EntityDetail.seq`. A membership change
   * bumps it without touching `updatedAt`, so adding a member never reorders the World Index.
   */
  readonly seq: number;
  /**
   * The Owner-curated Pinned Entities (CONTEXT.md → Pinned Entity): one shared,
   * ordered id list, the same for everyone. References, not enforced FKs — a
   * pinned Entity a viewer can't reach simply drops off their Dashboard.
   */
  readonly pinnedEntityIds: readonly string[];
}

/**
 * A blank override is an absent one, so an untouched free-text control falls back to the Instance
 * default rather than 400ing or writing an empty string where a value is expected.
 */
function blankIsAbsent<T extends z.ZodType<unknown, string>>(value: T) {
  return z
    .string()
    .trim()
    .transform((s) => s || undefined)
    .pipe(value.optional())
    .optional();
}

/**
 * POST /worlds/import's non-file fields (ADR-0073) — a multipart body, so every value arrives as a
 * string and a boolean is accepted in either shape. All three apply to **this run only** and are
 * persisted nowhere: an override the caller omits falls back to `entities.inlineType` /
 * `entities.inlineTag`.
 */
export const vaultImportOptionsSchema = z.object({
  /**
   * Mint an Entity for each wikilink that names no imported note, rather than leaving an **Unresolved
   * Link**. Defaults **on**: an importer arrives with Obsidian's model, where an unresolved wikilink is
   * a visible to-write list rather than inert text (ADR-0073).
   */
  createUnresolved: z.union([z.boolean(), z.stringbool()]).default(true),
  /**
   * The Entity Type everything this run creates carries; absent → `entities.inlineType`. Shape-checked
   * here because this one crosses the trust boundary, unlike the config knob it overrides — a malformed
   * id would land in `types[0]`, which every reader treats as a registered key.
   */
  inlineType: blankIsAbsent(entityTypeSchema),
  /**
   * The Tag everything this run creates carries; **omitted** → `entities.inlineTag` (itself often
   * absent). Free text, folded through the Tag vocabulary by the importer — the configured knob needs
   * the same fold, so one site does it for both.
   *
   * Unlike `inlineType`, a present-but-blank value is *no tag*, not an absent override: an author who
   * empties the prefilled control on an Instance that configures a Tag means to mint untagged, and a
   * blank-is-absent reading is the one thing a this-run override could not express (ADR-0073). There
   * is no matching "no Type" — every Entity carries one. Bounded like every other name in the family
   * ({@link nameSchema}): the value rides verbatim onto every Entity the run mints.
   */
  inlineTag: z.string().trim().max(255).optional(),
});

export type VaultImportOptions = z.infer<typeof vaultImportOptionsSchema>;

/**
 * The result of a vault import. Unreadable files are skipped (never abort the
 * import) and tallied. `constructsDegraded` sums the per-file degradation
 * tallies from the markdown converter; `assetsStored` counts unique embedded
 * images, deduped by content.
 */
export interface ImportSummary {
  readonly worldId: string;
  readonly notesImported: number;
  readonly filesSkipped: number;
  /** Wikilinks answered by an already-known Entity — an imported note, or one this run already minted. */
  readonly linksResolved: number;
  /**
   * Wikilinks that named nothing and minted an Entity — one apiece, since the second `[[Zorblax]]` is
   * answered from the run's mints and tallies as resolved, so this reads equally as a count of Entities
   * created (ADR-0073). Always 0 with the create-unresolved switch off.
   */
  readonly linksCreated: number;
  readonly linksDangling: number;
  readonly assetsStored: number;
  readonly constructsDegraded: Record<string, number>;
}
