import { ChangeDetectionStrategy, Component, DestroyRef, Injector, computed, effect, inject } from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { VIEW_FIELD_KEY } from '@hexly/web-entity';
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
               resolved from the ViewRegistry — no type sniffing (ADR-0048). The frame
               around it is already drawn, so a deferred body arrives into a live page.

               The injector carries the Field key of a Structured Field's View down to the component
               that renders it (ADR-0050, #200). It is minted per View instance, so switching from one
               grid to another rebuilds the View and its store rather than re-pointing a live one. -->
          @if (activeComponent(); as component) {
            <ng-container *ngComponentOutlet="component; injector: viewInjector()" />
          }
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
  private readonly injector = inject(Injector);

  /** The component to outlet for the active View — absent only while a deferred body is in flight. */
  protected readonly activeComponent = computed(() => this.views.component(this.viewStore.activeView().viewId));

  /**
   * The injector the active View's component is created in — the page's own, plus the Metadata key of
   * the **Structured Field** that View renders (ADR-0050, #200). A map View reads its grid at *this*
   * key, so an Entity carrying two grids gives each map View its own store over its own slice of the
   * body. A Type's own View (Content, a stat block) renders no particular Field and is handed nothing.
   *
   * DI rather than a component `@Input`, because a View provides its store in `providers` — which
   * Angular constructs before it sets an input, so an input would arrive too late for the store that
   * needs it. That it is the *injector* also earns the teardown: `NgComponentOutlet` rebuilds the
   * component when this reference changes, so switching between two grids yields a fresh store and a
   * fresh undo stack rather than re-pointing a live one at another Field.
   *
   * Recomputed only when the View instance's key changes ({@link EntityViewStore.activeKey}, a
   * string), so a re-derived afforded set cannot silently rebuild a live View.
   */
  protected readonly viewInjector = computed(() => {
    const fieldKey = this.viewStore.activeFieldKey();
    return Injector.create({
      parent: this.injector,
      providers: fieldKey ? [{ provide: VIEW_FIELD_KEY, useValue: fieldKey }] : [],
    });
  });

  constructor() {
    // Register the core Views from the lazy entity chunk, dropping them when the page is torn down
    // (ADR-0048). Kept out of the root ViewRegistry so the heavy view bodies (the map, TipTap) stay
    // off the initial bundle. A bundled plugin's Views are already there, seeded by its
    // `providePluginX()`, so the page names no plugin.
    const unregister = CORE_VIEW_DEFINITIONS.map((d) => this.views.register(d));
    inject(DestroyRef).onDestroy(() => unregister.forEach((u) => u()));

    // Fetch a deferred View's body once it is the active one.
    effect(() => this.views.fetch(this.viewStore.activeView().viewId));

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
