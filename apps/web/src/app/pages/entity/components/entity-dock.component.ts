import { ChangeDetectionStrategy, Component, Type, computed, effect, inject, signal, untracked } from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { TranslocoPipe } from '@jsverse/transloco';
import { EntityDock, PanelDefinition, PanelId, UNIVERSAL_PANELS } from '@hexly/web-entity';
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
 * — and write-gates each against {@link EntitySession.writable} (ADR-0037). The open Panel's body is
 * fetched on first open and outletted.
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
    @if (dock.openPanel()) {
      @if (openComponent(); as component) {
        <div
          data-testid="dock-panel"
          class="absolute right-full top-0 bottom-0 z-10 flex w-80 flex-col border-l border-line bg-surface shadow-2 lg:static lg:z-auto lg:shadow-none"
        >
          <ng-container *ngComponentOutlet="component" />
        </div>
      }
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
  private readonly universal = inject(UNIVERSAL_PANELS);

  /** Lazily-fetched Panel bodies, keyed by Panel id; never evicted (a component class is stable). */
  private readonly loaded = signal<ReadonlyMap<PanelId, Type<unknown>>>(new Map());

  /**
   * The Panels the current View offers: the universal set (narrowed per mount) merged with the active
   * View's declared Panels, minus any write-gated Panel a read-only viewer may not have (ADR-0037).
   */
  private readonly availablePanels = computed<readonly PanelDefinition[]>(() => {
    const view = this.views.resolve(this.viewStore.activeView().viewId).panels ?? [];
    const writable = this.session.writable();
    return [...this.universal, ...view].filter((panel) => !panel.writeGate || writable);
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

  /** The component to outlet for the open Panel — `undefined` only while a deferred body is in flight. */
  protected readonly openComponent = computed<Type<unknown> | undefined>(() => {
    const panel = this.dock.openPanel();
    if (!panel) return undefined;
    return panel.component ?? this.loaded().get(panel.id);
  });

  private fetch(panel: PanelDefinition): void {
    panel.loadComponent?.().then((component) => this.loaded.update((m) => new Map(m).set(panel.id, component)));
  }

  /** A stable, readable toggle testid from the Panel id's last segment (`core.panel.references` → `references-toggle`). */
  protected toggleTestId(id: PanelId): string {
    return `${id.split('.').pop()}-toggle`;
  }
}
