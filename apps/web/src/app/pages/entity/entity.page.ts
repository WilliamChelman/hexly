import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { Observable, concat, distinctUntilChanged, ignoreElements, map, of } from 'rxjs';
import { EntityDock } from '@hexly/web-entity';
import { EntitySession } from './services/entity-session';
import { EntityViewStore } from './services/entity-view-store';
import { EntityHeaderComponent } from './components/entity-header.component';
import { EntityViewOutletComponent } from './components/entity-view-outlet.component';
import { EntityDockComponent } from './components/entity-dock.component';
import { ViewRegistry } from '../../entity-types/view-registry';
import { CORE_VIEW_DEFINITIONS } from './views/core-views';

/**
 * The open-Entity route (`/entities/:id`): loads the Entity into {@link EntitySession} and
 * lays out its editor — one frame for every Entity type (ADR-0022). The {@link EntityHeaderComponent}
 * docks above; the body is the {@link EntityViewOutletComponent} (Seam C, #264), which resolves and
 * outlets the active View (ADR-0048) and owns the card/dangling fallbacks — one implementation shared
 * with the Board Embed.
 *
 * Stays the routed component across `:id` changes: only the outletted body changes, never the frame.
 */
@Component({
  selector: 'app-entity-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full overflow-hidden' },
  // EntityViewStore is page-scoped: it reads the open Entity's types off the session, provided above
  // the page in both the routed and Public Link mounts. EntityDock is page-scoped too (ADR-0067):
  // provided above the View outlet so the running View can claim the open slot. The content View's
  // own dock stores stay the View's (ADR-0051) — provided in `ContentView`, as the map's are in `MapView`.
  providers: [EntityViewStore, EntityDock],
  imports: [EntityHeaderComponent, EntityViewOutletComponent, EntityDockComponent, TranslocoPipe],
  template: `
    @if (session.current()) {
      <div class="grid h-full" style="grid-template-rows: auto 1fr">
        <!-- Page-owned header docked above the body (ADR-0022). -->
        <app-entity-header />
        <!-- Body: the View's main content beside the page-owned Dock column (ADR-0067). The Dock's
             open Panel is an in-flow column at wide viewports (main shrinks) and an overlay below. -->
        <div class="grid min-h-0" style="grid-template-columns: minmax(0, 1fr) auto">
          <main class="relative min-h-0 overflow-hidden">
            <!-- The View body — resolution, outletting, and the card/dangling fallbacks — is the
                 reusable Entity View Outlet's now (Seam C, #264), shared with the Board Embed. The page
                 drives its own route-loaded session, so it passes no target id and the default context. -->
            <app-entity-view-outlet />
          </main>
          <app-entity-dock />
        </div>
      </div>
    } @else if (session.evicted()) {
      <!-- Live eviction (ADR-0044, #174): the followed Entity became unreachable (deleted,
           made private, or un-shared) — an honest empty state instead of stale content. -->
      <div
        data-testid="entity-unavailable"
        class="h-full flex flex-col items-center justify-center gap-2 text-center px-6"
        role="status"
      >
        <p class="text-lg font-medium">
          {{ 'editorShell.unavailable.title' | transloco }}
        </p>
        <p class="text-ink-muted">
          {{ 'editorShell.unavailable.body' | transloco }}
        </p>
      </div>
    }
  `,
})
export class EntityPage {
  protected readonly session = inject(EntitySession);
  private readonly viewStore = inject(EntityViewStore);
  private readonly views = inject(ViewRegistry);

  constructor() {
    // Register the core Views from the lazy entity chunk, dropping them when the page is torn down.
    // Kept out of the root ViewRegistry so the heavy view bodies (the map, TipTap) stay off the
    // initial bundle. The Entity View Outlet the body mounts resolves against this root registry.
    const unregister = CORE_VIEW_DEFINITIONS.map((d) => this.views.register(d));
    inject(DestroyRef).onDestroy(() => unregister.forEach((u) => u()));

    const route = inject(ActivatedRoute);
    this.session.watchRoute(route);
    // The active View lives in the URL: refresh / shared link restores it (the View's key — its id,
    // and the Field it renders when it has one: `core.view.map:grid`, ADR-0050), opening another
    // Entity (no `view` param → null) resets to the default View (the primary type's first).
    route.queryParamMap
      .pipe(
        map((q) => q.get('view')),
        distinctUntilChanged(),
        takeUntilDestroyed(),
      )
      .subscribe((view) => this.viewStore.setView(view));
  }

  /**
   * Awaited by the route's CanDeactivate guard (ADR-0026): persist any pending edit before
   * the route is torn down, then allow the leave. Always resolves true — a failed/timed-out
   * flush is best-effort and must never trap the user on the page.
   */
  canDeactivate(): Observable<boolean> {
    return concat(this.session.flush().pipe(ignoreElements()), of(true));
  }
}
