/**
 * The **Mount** domain (CONTEXT.md → Mount, ADR-0080): the Containers a World declares it draws from.
 * A Mount widens what a World may *point at*, never what it *holds*, so nothing here says anything
 * about containment — it is a declaration, and the reads widen behind it.
 */

import * as z from 'zod';

/**
 * The kinds of **Container** (ADR-0078), on the wire: a **World** a user authors into, or a
 * **Compendium** shelf. A Mount names its Container's kind because "my other campaign" and "an
 * installed pack" are not the same thing to the Owner arranging them.
 */
export const containerKindSchema = z.enum(['world', 'compendium']);

/** CONTEXT.md → Container. */
export type ContainerKind = z.infer<typeof containerKindSchema>;

/**
 * One Mount as `GET /worlds/:id/mounts` lists it: the mounted Container's identity and kind, in the
 * Owner-arranged order. The mounting World is the route's own `:id`, so it is not repeated here — and
 * `GET /worlds/:id/mount-candidates` answers in the same shape, an add turning one into the other.
 */
export interface Mount {
  /**
   * The **mounted** Container's id — the one end a Mount names on the wire. The stored row names both
   * (`container_mounts.container_id` is the mounting side), which is why the column and this field
   * share a word for opposite ends.
   */
  readonly containerId: string;
  readonly name: string;
  readonly kind: ContainerKind;
}

/**
 * The blast radius of an act that breaks links (ADR-0080, #414): how many links point into a Container,
 * and how many **Worlds** they come from. Read per act rather than stored, so it is never stale, and
 * counted raw rather than per-viewer — a count that hid what the caller cannot read would understate
 * the damage. It never refuses the act: a destructive act another user's configuration could veto is
 * worse than a dangling link.
 */
export interface InboundLinkCount {
  /**
   * Links pointing in from the Worlds outside this Container — a **Decor Link** included, since a shelf
   * image going non-navigable is exactly the damage this number exists to state (ADR-0069). The
   * Container's own internal links are not blast radius, so they are never counted.
   */
  readonly links: number;
  /** How many Worlds those links come from; at most 1 where the question already named one, as unmount does. */
  readonly worlds: number;
}

/**
 * POST /worlds/:id/mounts: declare one more Container this World draws from, appended after the
 * Mounts already declared. Only the Container is client-supplied — a position is the reorder's
 * business, so an add has nothing to choose.
 */
export const addMountRequestSchema = z.object({ containerId: z.string().min(1) });

export type AddMountRequest = z.infer<typeof addMountRequestSchema>;

/**
 * PATCH /worlds/:id/mounts: the Mount order, sent wholesale as the pins are (ADR-0043) — the ordered
 * ids, deduped at the trust boundary. It reorders and nothing else: a list that is not a permutation
 * of what is mounted is refused, so the one write that never checks the Own-only rule can never
 * create a Mount either.
 */
export const reorderMountsRequestSchema = z.object({
  containerIds: z.array(z.string().min(1)).transform((ids) => [...new Set(ids)]),
});

export type ReorderMountsRequest = z.infer<typeof reorderMountsRequestSchema>;
