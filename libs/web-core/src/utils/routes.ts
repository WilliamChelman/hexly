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
 * The **Library** `/w/:worldId/library` (ADR-0080) — the Entity Browser preset to what this World
 * **Mounts**. The World in the path names the World whose Mounts are being read and the **Adoption**
 * target, not the content's home: what the Library lists lives in other Containers entirely.
 */
export function worldLibraryRoute(worldId: string, worldName?: string): string[] {
  return ['/w', segment(worldId, worldName), 'library'];
}

/**
 * A **Compendium page** `/w/:worldId/compendium/:compendiumId` (ADR-0079, #402) — one pack's own page,
 * stating the terms its content is published under. Reached from the **Library** that credits it, and
 * its World segment means what {@link worldLibraryRoute}'s does: the Adoption target, not a home.
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
