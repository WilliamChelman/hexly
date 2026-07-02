/**
 * Canonical app URL shapes as routerLink command arrays. One source for the
 * `/w/:worldId/entities[/:entityId]` scheme so a route change lands in a single
 * place instead of the ~8 hand-built copies that used to drift.
 */
export function worldRoute(worldId: string): string[] {
  return ['/w', worldId, 'entities'];
}

export function entityRoute(worldId: string, entityId: string): string[] {
  return ['/w', worldId, 'entities', entityId];
}
