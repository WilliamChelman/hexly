import { segment } from './pretty-id';

/**
 * Canonical app URL shapes as routerLink command arrays. One source for the
 * `/w/:worldId/entities[/:entityId]` scheme so a route change lands in a single
 * place instead of the ~8 hand-built copies that used to drift.
 *
 * Each id-bearing segment renders as a decorative `slug-base62(id)` (ADR-0042);
 * pass the name to get the slug, omit it for a bare code that the entity page's
 * reconcile guard self-heals into the full pretty form on load.
 */
export function worldRoute(worldId: string, worldName?: string): string[] {
  return ['/w', segment(worldId, worldName), 'entities'];
}

/**
 * The World root `/w/:worldId` — the World Dashboard landing surface (ADR-0043).
 * Where "open this World" and "create a World" both land, distinct from the Entity
 * browser (`worldRoute`).
 */
export function worldDashboardRoute(worldId: string, worldName?: string): string[] {
  return ['/w', segment(worldId, worldName)];
}

/**
 * World Settings `/w/:worldId/settings` (#158). Pretty-segment like the others so a
 * nav link matches the healed URL and never trips activeWorldGuard's heal redirect.
 */
export function worldSettingsRoute(worldId: string, worldName?: string): string[] {
  return ['/w', segment(worldId, worldName), 'settings'];
}

export function entityRoute(
  worldId: string,
  entityId: string,
  worldName?: string,
  entityName?: string,
): string[] {
  return ['/w', segment(worldId, worldName), 'entities', segment(entityId, entityName)];
}
