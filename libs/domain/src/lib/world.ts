/**
 * The World domain (ADR-0024): a lightweight container record that groups
 * Entities for one campaign or setting. Not an Entity type — it lives outside
 * the entity model in its own table. The single Zod source of truth (ADR-0001)
 * for the World model and its REST payloads.
 */

import { z } from 'zod';
import { ENTITY_LIST_MAX_LIMIT, nameSchema } from './entity';

/**
 * A World container (CONTEXT.md → World): a `name` and its `owners`. The landing
 * page is a derived World Dashboard (ADR-0043), not a stored Entity, so a World
 * never points back at an Entity (no circular FK).
 */
export const worldSchema = z.object({
  id: z.string(),
  name: nameSchema,
  owners: z.array(z.string()),
});

/**
 * World membership roles (ADR-0024, ADR-0037): `owner` is the symmetric
 * ownership set (full control); `contributor` and `viewer` sit below it.
 */
export const worldRoleSchema = z.enum(['owner', 'contributor', 'viewer']);

/** CONTEXT.md → World Owner / Contributor / World Viewer. */
export type WorldRole = z.infer<typeof worldRoleSchema>;

/**
 * The closed set of actions a caller may exercise on a World (CONTEXT.md → Rights, ADR-0039):
 * `read` (reachable) and `manage` (World Owner — rename, delete, members, owners, Public Link;
 * all one `isOwner` gate today). Reported with the World so the World Index and settings gate
 * on what the server enforces. Per-resource by design — a World has no substance to `edit`.
 */
export const worldVerbSchema = z.enum(['read', 'manage']);

/** CONTEXT.md → Rights (World). */
export type WorldVerb = z.infer<typeof worldVerbSchema>;

/**
 * The roles a World Owner can assign through the membership endpoints (ADR-0037, #159):
 * `contributor` (creates Entities, reads `shared`) and `viewer` (reads `shared` only).
 * `owner` is excluded — it belongs to the ownership-set endpoints, not member management.
 */
export const memberRoleSchema = z.enum(['contributor', 'viewer']);

export type MemberRole = z.infer<typeof memberRoleSchema>;

/** A non-owner World member (ADR-0037): an Instance user with a Contributor or Viewer role. */
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
 * PATCH /worlds/:id (ADR-0043, #168): a partial update of the two Owner-curated fields —
 * the `name` (rename) and/or the ordered `pinnedEntityIds` set. Pins are sent wholesale:
 * add, remove, and reorder all collapse to "send the new array". Ids are references, not
 * enforced FKs — a stale or inaccessible id is filtered per-viewer on read, never rejected
 * here. Both fields optional so a rename and a re-pin are independent PATCHes.
 */
export const updateWorldRequestSchema = z.object({
  name: nameSchema.optional(),
  // Deduped at the trust boundary (mirroring dedupedTags): duplicate ids would resolve
  // to duplicate Dashboard cards and crash the `@for` track-by. Capped at the pin-resolve
  // ceiling so the stored set can never exceed what a single access-filtered read returns
  // — an over-cap set is a 400 here, not a silently-truncated Dashboard.
  pinnedEntityIds: z
    .array(z.string())
    .max(ENTITY_LIST_MAX_LIMIT)
    .transform((ids) => [...new Set(ids)])
    .optional(),
});

export type UpdateWorldRequest = z.infer<typeof updateWorldRequestSchema>;

/**
 * Add an Owner to a World or Entity's ownership set (ADR-0037): the target must be
 * an existing Instance user. Shared by the Worlds and Entities owner-set endpoints.
 */
export const addOwnerRequestSchema = z.object({ userId: z.string().min(1) });

export type AddOwnerRequest = z.infer<typeof addOwnerRequestSchema>;

/** What a World read surface returns — the stored record plus its timestamps. */
export interface WorldSummary {
  readonly id: string;
  readonly name: string;
  /** The World's ownership set (ADR-0037): one or more equal Owner user ids. */
  readonly owners: readonly string[];
  /**
   * The caller's Rights on this World (CONTEXT.md → Rights, ADR-0039): always present and
   * non-empty — a reachable World carries at least `read`, an Owner also `manage`. The World
   * Index gates its owner badge and settings entry on this, not on scanning `owners`.
   */
  readonly rights: readonly WorldVerb[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

/**
 * A single World — what POST/GET/PATCH `/worlds/:id` return. The landing page is a
 * derived World Dashboard (ADR-0043), not a stored Entity, so the Detail carries no
 * home id to navigate to.
 */
export interface WorldDetail extends WorldSummary {
  /**
   * How many Entities live in this World — the number a delete would destroy
   * (ADR-0024, #120). Surfaced on the Detail so the World Index's type-to-confirm
   * delete can state the cost without a heavy endpoint.
   */
  readonly entityCount: number;
  /**
   * The Owner-curated Pinned Entities (ADR-0043, CONTEXT.md → Pinned Entity): one
   * shared, ordered id list surfaced on the World Dashboard, the same for everyone.
   * References, not enforced FKs — a pinned Entity a viewer can't reach simply drops
   * off their Dashboard when the cards are resolved through the entity read path.
   */
  readonly pinnedEntityIds: readonly string[];
}

/**
 * The result of a vault import (ADR-0033, #146) — the primary "what did we lose"
 * instrument. Every markdown file that became a note is counted; unreadable files
 * are skipped (never abort the import) and tallied. `constructsDegraded` sums the
 * per-file degradation tallies from the markdown converter (footnotes, math,
 * mermaid, comments, …). `assetsStored` counts the unique embedded images pulled into
 * per-World content-addressed storage (ADR-0034), deduped by content.
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
