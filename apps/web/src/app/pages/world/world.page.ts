import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import {
  ActiveWorld,
  worldAssetsRoute,
  worldCompendiumRoute,
  worldDashboardRoute,
  worldGraphRoute,
  worldRoute,
  worldSettingsRoute,
} from '@hexly/web-core';
import { NavRailStore } from '../../shell/nav-rail.store';
import { WorldTypesLoader } from '../../entity-types/world-types-loader';
import { WorldFieldsLoader } from '../../entity-types/world-fields-loader';

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
export class WorldPage {
  constructor() {
    const activeWorld = inject(ActiveWorld);
    const rail = inject(NavRailStore);
    // Project the active World's user-defined types and Fields into the TypeRegistry for as long as a
    // World is open (#191, #230) — injecting them here is what brings the reactive loaders to life.
    inject(WorldTypesLoader);
    inject(WorldFieldsLoader);

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
        // The pair re-picked together (#393 left the choice to this ticket): `library` goes to the
        // Compendium, which is the reference shelf that word leans at, and the author's own work to its own.
        {
          link: worldRoute(worldId, name),
          testid: 'nav-entities',
          icon: 'entities',
          labelKey: 'nav.entities',
        },
        // The Compendium browse (ADR-0079): Instance-wide and readable by every signed-in caller, so no
        // rights gate — and no read of *this* World, whose id names the Adoption target (#403).
        {
          link: worldCompendiumRoute(worldId, name),
          testid: 'nav-compendium',
          icon: 'library',
          labelKey: 'nav.compendium',
        },
        // The Asset Browser (ADR-0065): a read of the World's media, so every reader gets it — the
        // reader-scoped list shows an owner their private uploads and a Viewer only what is shared.
        {
          link: worldAssetsRoute(worldId, name),
          testid: 'nav-assets',
          icon: 'asset',
          labelKey: 'nav.assets',
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
