import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ActiveWorld, worldDashboardRoute, worldGraphRoute, worldRoute, worldSettingsRoute } from '@hexly/web-core';
import { NavRailStore } from '../../shell/nav-rail.store';
import { WorldTypesLoader } from '../../entity-types/world-types-loader';

/**
 * The World scope's layout: owner of the `w/:worldId` subtree. The World — not the nav
 * rail — declares its own contextual links (ADR-0041), filling the rail slot from the
 * pinned active World and clearing it on leave. Reactive, so a World switch or a slug
 * self-heal (ADR-0042) re-derives the links.
 */
@Component({
  selector: 'app-world-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
export class WorldLayout {
  constructor() {
    const activeWorld = inject(ActiveWorld);
    const rail = inject(NavRailStore);
    // Project the active World's user-defined types into the TypeRegistry for as long as a World is
    // open (#191) — injecting it here is what brings the reactive loader to life.
    inject(WorldTypesLoader);

    effect(() => {
      const worldId = activeWorld.worldId();
      if (!worldId) return; // activeWorldGuard pins it before any child renders.
      // Canonical slug-base62 links (ADR-0042), so clicks don't trip the heal redirect.
      const name = activeWorld.name() ?? undefined;
      // World Settings shows only to a caller who may manage the World (ADR-0039).
      const canManage = !!activeWorld.world()?.rights?.includes('manage');
      rail.entries.set([
        {
          link: worldDashboardRoute(worldId, name),
          testid: 'nav-dashboard',
          icon: 'dashboard',
          labelKey: 'nav.dashboard',
          exact: true,
        },
        {
          link: worldRoute(worldId, name),
          testid: 'nav-entities',
          icon: 'library',
          labelKey: 'nav.library',
        },
        // The World Graph is a read of the World, so every reader gets it — no rights gate.
        {
          link: worldGraphRoute(worldId, name),
          testid: 'nav-world-graph',
          icon: 'graph',
          labelKey: 'nav.graph',
        },
        ...(canManage
          ? [
              {
                link: worldSettingsRoute(worldId, name),
                testid: 'nav-world-settings',
                icon: 'settings' as const,
                labelKey: 'nav.worldSettings',
              },
            ]
          : []),
      ]);
    });

    inject(DestroyRef).onDestroy(() => rail.entries.set([]));
  }
}
