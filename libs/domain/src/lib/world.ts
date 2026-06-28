/**
 * The World domain (ADR-0024): a lightweight container record that groups
 * Entities for one campaign or setting. Not an Entity type — it lives outside
 * the entity model in its own table. The single Zod source of truth (ADR-0001)
 * for the World model and its REST payloads.
 */

import { z } from 'zod';
import { nameSchema } from './entity';

/**
 * A World container (CONTEXT.md → World): a `name` and its `ownerId`. The Home
 * Entity is not a column here — it is the World's Entity flagged `is_home`
 * (ADR-0024), so a World never points back at an Entity (no circular FK).
 */
export const worldSchema = z.object({
  id: z.string(),
  name: nameSchema,
  ownerId: z.string(),
});

/** The named World roles below the Owner (ADR-0024): Owner lives on `worlds.owner_id`, not a member row. */
export const worldRoleSchema = z.enum(['contributor', 'viewer']);

/** CONTEXT.md → Contributor / World Viewer. */
export type WorldRole = z.infer<typeof worldRoleSchema>;

/** POST /worlds: only the name is client-supplied; the Home Entity is minted server-side. */
export const createWorldRequestSchema = z.object({ name: nameSchema });

export type CreateWorldRequest = z.infer<typeof createWorldRequestSchema>;

/** What a World read surface returns — the stored record plus its timestamps. */
export interface WorldSummary {
  readonly id: string;
  readonly name: string;
  readonly ownerId: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/**
 * A single World plus its Home Entity id (ADR-0024) — what POST/GET/PATCH
 * `/worlds/:id` return. The id is enough for the client to navigate to the
 * landing page (`/entities/:homeEntityId`); the body is fetched on open.
 */
export interface WorldDetail extends WorldSummary {
  readonly homeEntityId: string;
}
