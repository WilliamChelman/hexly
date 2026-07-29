import { segment } from './pretty-id';

/**
 * Canonical app URL shapes as routerLink command arrays.
 *
 * Each id-bearing segment renders as a decorative `slug-base62(id)` (ADR-0042);
 * pass the name to get the slug, omit it for a bare code that the entity page's
 * reconcile guard self-heals into the full pretty form on load.
 */
export function worldRoute(worldId: string, worldName?: string): string[] {
  return ['/w', segment(worldId, worldName), 'entities'];
}

/**
 * The World root `/w/:worldId` — the World Dashboard landing surface (ADR-0043), distinct from
 * the Entity browser ({@link worldRoute}).
 */
export function worldDashboardRoute(worldId: string, worldName?: string): string[] {
  return ['/w', segment(worldId, worldName)];
}

/**
 * World Settings `/w/:worldId/settings`. Pretty-segment like the others so a nav link matches the
 * healed URL and never trips activeWorldGuard's heal redirect.
 */
export function worldSettingsRoute(worldId: string, worldName?: string): string[] {
  return ['/w', segment(worldId, worldName), 'settings'];
}

/** The World Graph `/w/:worldId/graph` — the node-link view of the World's Entities. */
export function worldGraphRoute(worldId: string, worldName?: string): string[] {
  return ['/w', segment(worldId, worldName), 'graph'];
}

/**
 * The Asset Browser `/w/:worldId/assets` (ADR-0065) — the Entity Browser preset to the asset type,
 * where a World's uploaded media is managed as thumbnail tiles.
 */
export function worldAssetsRoute(worldId: string, worldName?: string): string[] {
  return ['/w', segment(worldId, worldName), 'assets'];
}

/**
 * The Compendium browse `/w/:worldId/compendium` (ADR-0079) — the Entity Browser preset unioning every
 * installed pack. The World in the path names the **adoption target**, not the content's home: a
 * Compendium is Instance-wide and lives in no World, so the segment is the World you would adopt into.
 */
export function worldCompendiumRoute(worldId: string, worldName?: string): string[] {
  return ['/w', segment(worldId, worldName), 'compendium'];
}

/**
 * A **Compendium page** `/w/:worldId/compendium/:compendiumId` (ADR-0079, #402) — one pack's own page,
 * stating the terms its content is published under. Nested under the browse it is reached from, and its
 * World segment means what {@link worldCompendiumRoute}'s does: the adoption target, not a home.
 */
export function worldCompendiumPageRoute(
  worldId: string,
  compendiumId: string,
  worldName?: string,
  compendiumName?: string,
): string[] {
  return ['/w', segment(worldId, worldName), 'compendium', segment(compendiumId, compendiumName)];
}

export function entityRoute(worldId: string, entityId: string, worldName?: string, entityName?: string): string[] {
  return ['/w', segment(worldId, worldName), 'entities', segment(entityId, entityName)];
}
