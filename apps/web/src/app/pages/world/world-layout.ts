import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import {
  ActiveWorld,
  worldDashboardRoute,
  worldRoute,
  worldSettingsRoute,
} from '@hexly/web-core';
import { NavRailStore } from '../../shell/nav-rail.store';

/**
 * The World scope's layout: a thin owner for the `w/:worldId` subtree (previously
 * componentless). It exists so the World — not the nav rail — declares its own
 * contextual links (ADR-0041), filling the rail slot from the pinned active World
 * and clearing it on leave. Reactive so a World switch or slug self-heal (ADR-0042)
 * re-derives the links without the rail knowing anything about Worlds.
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
