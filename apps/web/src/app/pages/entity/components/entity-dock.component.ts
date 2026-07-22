import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  Type,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { TranslocoPipe } from '@jsverse/transloco';
import { EntityDock, PANEL_FILTER, PanelDefinition, PanelId, UNIVERSAL_PANELS } from '@hexly/web-entity';
import { IconComponent, IconButtonComponent } from '@hexly/web-ui';
import { EntitySession } from '../services/entity-session';
import { EntityViewStore } from '../services/entity-view-store';
import { ViewRegistry } from '../../../entity-types/view-registry';

/**
 * The Entity page's **Dock** chrome (ADR-0067): an always-visible toggle strip on the page's right
 * edge, plus the one open Panel beside it. It renders {@link EntityDock}'s slot state; the service
 * itself is page-scoped, provided above the View outlet so a View can claim the slot.
 *
 * It derives the strip synchronously from the **universal** Panels merged with the active View's
 * declared {@link ViewDefinition.panels} — so the toggles are known before any Panel's lazy body loads
 * — and write-gates each against {@link EntitySession.writable} (ADR-0037). The open Panel's body is fetched
 * on first open and outletted; a View-contributed Panel is outletted with the running View's injector
 * ({@link EntityDock.viewInjector}, #294), so it reaches the View-scoped services its host View provides.
 *
 * The layout is a flex row `[panel][strip]`. At the `lg` breakpoint the open Panel is an in-flow
 * column, so the page's grid shrinks the main content to make room (it *pushes*); below it the Panel is
 * absolutely positioned left of the strip, *overlaying* the main content instead.
 */
@Component({
  selector: 'app-entity-dock',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'relative flex min-h-0' },
  imports: [NgComponentOutlet, IconComponent, IconButtonComponent, TranslocoPipe],
  template: `
    @if (openPanelBody(); as body) {
      <div
        data-testid="dock-panel"
        class="absolute right-full top-0 bottom-0 z-10 flex w-80 flex-col border-l border-line bg-surface shadow-2 lg:static lg:z-auto lg:shadow-none"
      >
        <ng-container *ngComponentOutlet="body.component; injector: body.injector" />
      </div>
    }
    <!-- Always-visible strip: one toggle per available Panel, known before any lazy body loads. -->
    <div
      data-testid="dock-strip"
      class="flex w-14 shrink-0 flex-col items-center gap-2 border-l border-line bg-surface-sunken py-3"
    >
      @for (panel of dock.available(); track panel.id) {
        <button
          appIconButton
          toggle
          [active]="dock.openPanel()?.id === panel.id"
          [title]="panel.labelKey | transloco"
          [attr.aria-label]="panel.labelKey | transloco"
          [attr.data-testid]="toggleTestId(panel.id)"
          (click)="dock.toggle(panel.id)"
        >
          <app-icon [name]="panel.icon" [size]="20" />
        </button>
      }
    </div>
  `,
})
export class EntityDockComponent {
  protected readonly dock = inject(EntityDock);
  private readonly views = inject(ViewRegistry);
  private readonly viewStore = inject(EntityViewStore);
  private readonly session = inject(EntitySession);
  private readonly panelFilter = inject(PANEL_FILTER);

  /** Lazily-fetched Panel bodies, keyed by Panel id; never evicted (a component class is stable). */
  private readonly loaded = signal<ReadonlyMap<PanelId, Type<unknown>>>(new Map());

  /**
   * The Panels the current View offers: the universal set merged with the active View's declared
   * Panels, kept through the page's {@link PANEL_FILTER} (a Public Link page drops References), then
   * minus any write-gated Panel a read-only viewer may not have (ADR-0037).
   */
  private readonly availablePanels = computed<readonly PanelDefinition[]>(() => {
    const view = this.views.resolve(this.viewStore.activeView().viewId).panels ?? [];
    const writable = this.session.writable();
    return [...UNIVERSAL_PANELS, ...view].filter((panel) => this.panelFilter(panel) && (!panel.writeGate || writable));
  });

  constructor() {
    // Feed the derived availability into the page-scoped Dock, which resolves the open slot against it
    // (close-don't-substitute when the remembered Panel drops out of the set).
    effect(() => this.dock.setAvailable(this.availablePanels()));

    // Fetch the open Panel's deferred body once, on first open.
    effect(() => {
      const panel = this.dock.openPanel();
      if (panel && !panel.component && !this.loaded().has(panel.id)) untracked(() => this.fetch(panel));
    });
  }

  /**
   * The open Panel's body and the injector to create it in — `undefined` while a deferred body is still
   * in flight, or while a View-contributed Panel awaits its View's injector.
   *
   * A **universal** Panel (References, Details) resolves against the Dock's own page injector, so it takes
   * no injector here. A **View-contributed** Panel (the Content View's Outline) is instantiated with the
   * running View's injector (ADR-0067, #294) so it reaches the View-scoped services its host View provides
   * (the Outline's `OutlineStore`); it is withheld until that injector arrives, so it never constructs
   * against the wrong scope.
   */
  protected readonly openPanelBody = computed<{ component: Type<unknown>; injector?: Injector } | undefined>(() => {
    const panel = this.dock.openPanel();
    if (!panel) return undefined;
    const component = panel.component ?? this.loaded().get(panel.id);
    if (!component) return undefined;
    if (UNIVERSAL_PANELS.some((p) => p.id === panel.id)) return { component };
    const injector = this.dock.viewInjector();
    return injector ? { component, injector } : undefined;
  });

  private fetch(panel: PanelDefinition): void {
    panel.loadComponent?.().then((component) => this.loaded.update((m) => new Map(m).set(panel.id, component)));
  }

  /** A stable, readable toggle testid from the Panel id's last segment (`core.panel.references` → `references-toggle`). */
  protected toggleTestId(id: PanelId): string {
    return `${id.split('.').pop()}-toggle`;
  }
}
