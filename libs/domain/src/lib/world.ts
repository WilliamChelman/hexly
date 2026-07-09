/**
 * The World domain: a lightweight container record that groups Entities for one
 * campaign or setting. Not an Entity type — it lives outside the entity model
 * in its own table. The single Zod source of truth for the World model and its
 * REST payloads.
 */

import { z } from 'zod';
import { ENTITY_LIST_MAX_LIMIT, nameSchema } from './entity';

/**
 * A World container (CONTEXT.md → World): a `name` and its `owners`. The landing
 * page is a derived World Dashboard, not a stored Entity, so a World never
 * points back at an Entity (no circular FK).
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
 * Rights): `read` (reachable) and `manage` (World Owner). Reported with the
 * World so surfaces gate on what the server enforces — a World has no substance
 * to `edit`.
 */
export const worldVerbSchema = z.enum(['read', 'manage']);

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

/**
 * Add an Owner to a World or Entity's ownership set; the target must be an
 * existing Instance user. Shared by the Worlds and Entities owner-set endpoints.
 */
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
   * carries at least `read`, an Owner also `manage`. Surfaces gate on this,
   * not on scanning `owners`.
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
 * The result of a vault import — the "what did we lose" instrument. Unreadable
 * files are skipped (never abort the import) and tallied. `constructsDegraded`
 * sums the per-file degradation tallies from the markdown converter;
 * `assetsStored` counts unique embedded images, deduped by content.
 */
export interface ImportSummary {
  readonly worldId: string;
  readonly notesImported: number;
  readonly filesSkipped: number;
  readonly linksResolved: number;
  readonly linksDangling: number;
  readonly assetsStored: number;
  readonly constructsDegraded: Record<string, number>;
}
