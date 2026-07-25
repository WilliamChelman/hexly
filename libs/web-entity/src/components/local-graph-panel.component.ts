import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  ButtonComponent,
  EyebrowComponent,
  IconComponent,
  MenuItemCheckboxDirective,
  MenuPanelDirective,
  MenuTriggerDirective,
} from '@hexly/web-ui';
import { GraphCanvasComponent, GraphOpen } from '../graph/graph-canvas.component';
import { openEntityRoute } from '../navigation/open-entity';
import { LocalGraphStore } from '../services/local-graph-store';

/**
 * The **Local Graph Panel** (ADR-0072) — a universal Panel of the page's Dock (ADR-0067), beside
 * References: the same node-link drawing the World Graph page shows, centred on the open Entity and
 * bounded to its neighbourhood.
 *
 * It owns its {@link LocalGraphStore} in `providers`, so the store lives and dies with the open Panel:
 * opening it fetches, closing it drops the fetch, and reopening refetches.
 *
 * The **depth** control is the panel's own affordance (the World Graph page has no use for one — it draws
 * everything). It is a server bound, so a flip refetches; the choice is persisted per user, unlike the
 * ephemeral decor reveal, because how far out a reader likes to look is a habit, not a peek.
 */
@Component({
  selector: 'app-local-graph-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [LocalGraphStore],
  imports: [
    ButtonComponent,
    EyebrowComponent,
    GraphCanvasComponent,
    IconComponent,
    MenuItemCheckboxDirective,
    MenuPanelDirective,
    MenuTriggerDirective,
    TranslocoPipe,
  ],
  // Scrolls like the References panel: on a short viewport the Dock card is shorter than the drawing plus
  // its controls, and the controls must stay reachable.
  host: { class: 'flex flex-col gap-2 p-3 overflow-y-auto bg-surface min-h-0 flex-1' },
  template: `
    <div class="flex items-center justify-between gap-2">
      <span appEyebrow mark>{{ 'fields.localGraph.title' | transloco }}</span>
      <!-- The same floating filters menu the World Graph page carries, so one filter keeps one set of
           checkbox semantics wherever it is drawn (ADR-0007). Offered only when there is decor to show,
           so it is never dead chrome; decor can only annotate this drawing — the read never walks it
           (ADR-0069). -->
      @if (store.hasDecor()) {
        <button
          type="button"
          appButton
          size="sm"
          icon
          data-testid="local-graph-filters"
          [appMenuTrigger]="filtersMenu"
          [title]="'fields.localGraph.filters' | transloco"
          [attr.aria-label]="'fields.localGraph.filters' | transloco"
        >
          <app-icon name="settings" [size]="16" />
        </button>
      }
    </div>

    <!-- A square-ish box: the drawing needs height of its own inside a Dock card that has none to give. -->
    <div class="relative h-64 shrink-0 overflow-hidden rounded-md border border-line bg-surface-sunken">
      <!-- Nothing renders before the first read lands: "links to nothing" is a claim about the edge index,
           not about the fetch, and a lone dot is no drawing — so an isolated Entity gets the words instead. -->
      @if (store.graph(); as graph) {
        @if (store.isolated()) {
          <p
            class="absolute inset-0 m-0 flex items-center justify-center px-4 text-center text-sm text-ink-muted"
            data-testid="local-graph-isolated"
          >
            {{ 'fields.localGraph.isolated' | transloco }}
          </p>
        } @else {
          <!-- Held across a depth refetch rather than unmounted: a remount rebuilds cosmos.gl's WebGL
               context and recompiles its shaders on the main thread (ADR-0072). It dims while the read is
               in flight, and the counts below stand down, so the stale picture never reads as an answer. -->
          <div class="h-full transition-opacity" [class.opacity-40]="store.loading()">
            <app-graph-canvas [graph]="graph" [center]="store.center()" (open)="openEntity($event)" />
          </div>
        }
      }
      @if (store.loading()) {
        <span
          role="status"
          class="absolute bottom-1 left-1/2 -translate-x-1/2 rounded-sm bg-surface/80 px-1.5 py-0.5 font-sans text-xs text-ink-muted"
          data-testid="local-graph-loading"
        >
          {{ 'fields.localGraph.loading' | transloco }}
        </span>
      }
    </div>

    <div class="flex items-center justify-between gap-2">
      <span class="font-sans text-xs text-ink-muted">{{ 'fields.localGraph.depth' | transloco }}</span>
      <!-- One button per hop rather than a stepper: the whole range fits, so the reach the reader wants
           is always one click away, and the current one is readable without opening anything. -->
      <div class="flex items-center gap-0.5" role="group" [attr.aria-label]="'fields.localGraph.depth' | transloco">
        @for (depth of store.depths; track depth) {
          <button
            type="button"
            class="min-w-6 rounded-sm px-1.5 py-0.5 font-sans text-xs text-ink-muted hover:bg-surface-sunken aria-pressed:bg-gold/15 aria-pressed:text-gold aria-pressed:font-semibold"
            [attr.aria-pressed]="store.depth() === depth"
            [attr.aria-label]="'fields.localGraph.depthOption' | transloco: { depth }"
            [attr.data-testid]="'local-graph-depth-' + depth"
            (click)="store.setDepth(depth)"
          >
            {{ depth }}
          </button>
        }
      </div>
    </div>

    @if (!store.loading() && store.graph(); as graph) {
      <span class="font-sans text-xs text-ink-faint" data-testid="local-graph-counts">
        {{ 'fields.localGraph.counts' | transloco: { nodes: graph.nodes.length, edges: graph.edges.length } }}
      </span>
    }

    <ng-template #filtersMenu>
      <div appMenuPanel>
        <button
          type="button"
          appMenuItemCheckbox
          data-testid="local-graph-decor-toggle"
          [checked]="store.revealDecor()"
          (triggered)="store.toggleRevealDecor()"
        >
          {{ 'fields.localGraph.showDecor' | transloco }}
        </button>
      </div>
    </ng-template>
  `,
})
export class LocalGraphPanelComponent {
  protected readonly store = inject(LocalGraphStore);
  private readonly router = inject(Router);

  /** A click on a node opens that Entity by id, as a {@link ReferenceRowComponent} link does — no World needed. */
  protected openEntity({ id, newTab }: GraphOpen): void {
    openEntityRoute(this.router, ['/entities', id], newTab);
  }
}
