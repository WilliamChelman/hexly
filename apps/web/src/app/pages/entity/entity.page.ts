import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject } from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { Observable, concat, distinctUntilChanged, ignoreElements, map, of } from 'rxjs';
import { EntitySession } from './services/entity-session';
import { EntityViewStore } from './services/entity-view-store';
import { OutlineStore } from './services/outline-store';
import { ReferencesStore } from './services/references-store';
import { RightDock } from './services/right-dock';
import { EntityHeader } from './components/entity-header';
import { ViewRegistry } from '../../entity-types/view-registry';
import { CORE_VIEW_DEFINITIONS } from './views/core-views';
import { PLUGIN_VIEW_DEFINITIONS } from '../../plugins/bundled-views';

/**
 * The open-Entity route (`/entities/:id`, #70): the routed page that loads the
 * Entity into {@link EntitySession} and lays out its editor — one frame for every
 * Entity type (ADR-0022).
 *
 * A thin host (ADR-0048, *Views* amendment): the {@link EntityHeader} docks above,
 * and the body is a single `NgComponentOutlet` over the active View's component,
 * resolved from the {@link ViewRegistry} by {@link EntityViewStore.activeView}. There
 * is no `isHexmap` branch — the page dispatches on the active View id, and the core
 * Views (`MapView`, `ContentView`) register themselves the way a plugin would.
 *
 * Staying the routed component across `:id` changes keeps the editor mounted as the
 * open Entity swaps — only the outletted body changes, never the frame.
 */
@Component({
  selector: 'app-entity-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full overflow-hidden' },
  // The Content view's dock stores, scoped to the page that shows them. Provided *here*
  // rather than beside EntitySession on the route, because every context that mounts this
  // component needs them and none overrides them: a Public Link page reuses EntityPage, and
  // mirroring the route's provider list by hand is a contract nothing enforces (it silently
  // broke the public page once, #179). ContentView, outletted below, injects them from here.
  // EntityViewStore joins them: page-scoped, it reads the open Entity's types off the session
  // (provided above the page in both mounts) to derive the afforded Views and the active one.
  providers: [RightDock, OutlineStore, ReferencesStore, EntityViewStore],
  imports: [EntityHeader, NgComponentOutlet, TranslocoPipe],
  template: `
    @if (session.current()) {
      <div class="grid h-full" style="grid-template-rows: auto 1fr">
        <!-- Page-owned header docked above the body (ADR-0022). -->
        <app-entity-header />
        <main class="relative min-h-0">
          <!-- The active View's component (MapView / ContentView / a plugin view),
               resolved from the ViewRegistry — no type sniffing (ADR-0048). -->
          <ng-container *ngComponentOutlet="activeComponent()" />
        </main>
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

  /** The component to outlet for the active View — always resolves (content fallback). */
  protected readonly activeComponent = computed(() => this.views.resolve(this.viewStore.activeView()).component);

  constructor() {
    // Register the core Views and the bundled plugins' (#192) from the lazy entity chunk, dropping
    // them when the page is torn down (ADR-0048). Kept out of the root ViewRegistry so the heavy view
    // bodies stay off the initial bundle.
    const unregister = [...CORE_VIEW_DEFINITIONS, ...PLUGIN_VIEW_DEFINITIONS].map((d) => this.views.register(d));
    inject(DestroyRef).onDestroy(() => unregister.forEach((u) => u()));

    const route = inject(ActivatedRoute);
    this.session.watchRoute(route);
    // The active View lives in the URL: refresh / shared link restores it (the full
    // View id, ADR-0048), opening another Entity (no `view` param → null) resets to
    // the default View (the primary type's first).
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
