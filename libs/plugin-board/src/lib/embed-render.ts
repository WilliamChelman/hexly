/**
 * The pure cycle/depth resolution for an **Embed** render (ADR-0062). Kept domain-side, framework-free,
 * so the guardrail is unit-testable without a browser: the `-web` half threads the ancestor Entity-id
 * chain and the current depth down each Embed render, and asks this whether to transclude the target or
 * fall back to the card preview.
 */

/** How an Embed renders its target: the live transclusion, or the card-preview fallback. */
export type EmbedRender = 'transclude' | 'card';

/**
 * Whether an Embed of `targetEntityId` may transclude, given the `ancestorIds` already on the render path,
 * the current `depth`, and the Instance's `maxDepth` (`features.plugin.board.maxEmbedDepth`, default 3).
 *
 * Degrades to `'card'` when the target is already an ancestor (a cycle — a Board embedding itself directly
 * or through a loop) or the depth has reached the cap; otherwise `'transclude'`. Rendering-side reasons
 * (an unreadable target, a View that can no longer render) are the caller's to detect — this bounds only
 * recursion (ADR-0062).
 */
export function resolveEmbedRender(
  targetEntityId: string,
  ancestorIds: readonly string[],
  depth: number,
  maxDepth: number,
): EmbedRender {
  if (ancestorIds.includes(targetEntityId)) return 'card';
  if (depth >= maxDepth) return 'card';
  return 'transclude';
}
