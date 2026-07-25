import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { EyebrowComponent } from '@hexly/web-ui';
import { GraphCanvasComponent, GraphOpen } from '../graph/graph-canvas.component';
import { LocalGraphStore } from '../services/local-graph-store';

/**
 * The **Local Graph Panel** (ADR-0072) — a universal Panel of the page's Dock (ADR-0067), beside
 * References: the same node-link drawing the World Graph page shows, centred on the open Entity and
 * bounded to its neighbourhood. Where References answers "what links here, by name", this answers "what
 * does this Entity sit in the middle of".
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
  imports: [EyebrowComponent, GraphCanvasComponent, TranslocoPipe],
  // Scrolls like the References panel: on a short viewport the Dock card is shorter than the drawing plus
  // its controls, and the controls must stay reachable.
  host: { class: 'flex flex-col gap-2 p-3 overflow-y-auto bg-surface min-h-0 flex-1' },
  template: `
    <div class="flex items-center justify-between gap-2">
      <span appEyebrow mark>{{ 'fields.localGraph.title' | transloco }}</span>
      <!-- Offered only when there is decor to show, so it is never dead chrome (as on the References
           panel). Decor can only annotate this drawing — the read never walks it (ADR-0069). -->
      @if (store.hasDecor()) {
        <button
          type="button"
          [attr.aria-pressed]="store.revealDecor()"
          class="font-sans text-xs text-ink-muted px-1.5 py-0.5 rounded-sm hover:bg-surface-sunken aria-pressed:bg-gold/15 aria-pressed:text-gold"
          data-testid="local-graph-decor-toggle"
          (click)="store.toggleRevealDecor()"
        >
          {{ 'fields.links.showDecor' | transloco }}
        </button>
      }
    </div>

    <!-- A square-ish box: the drawing needs height of its own inside a Dock card that has none to give. -->
    <div class="relative h-64 shrink-0 overflow-hidden rounded-md border border-line bg-surface-sunken">
      <!-- Nothing renders before the read lands: "links to nothing" is a claim about the edge index, not
           about the fetch, and a lone dot is no drawing — so an isolated Entity gets the words instead. -->
      @if (store.graph(); as graph) {
        @if (store.isolated()) {
          <p
            class="absolute inset-0 m-0 flex items-center justify-center px-4 text-center text-sm text-ink-muted"
            data-testid="local-graph-isolated"
          >
            {{ 'fields.localGraph.isolated' | transloco }}
          </p>
        } @else {
          <app-graph-canvas [graph]="graph" [center]="store.center()" (open)="openEntity($event)" />
        }
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

    @if (store.graph(); as graph) {
      <span class="font-sans text-xs text-ink-faint" data-testid="local-graph-counts">
        {{ 'fields.localGraph.counts' | transloco: { nodes: graph.nodes.length, edges: graph.edges.length } }}
      </span>
    }
  `,
})
export class LocalGraphPanelComponent {
  protected readonly store = inject(LocalGraphStore);
  private readonly router = inject(Router);

  /**
   * A click on a node opens that Entity — the id route, as a {@link ReferenceRowComponent} link does, so
   * the panel needs no World in hand. A Ctrl/Cmd (or middle) click opens a new tab, as the modifier does
   * on any link.
   */
  protected openEntity({ id, newTab }: GraphOpen): void {
    const route = ['/entities', id];
    if (newTab) {
      const url = this.router.serializeUrl(this.router.createUrlTree(route));
      window.open(url, '_blank', 'noopener');
      return;
    }
    void this.router.navigate(route);
  }
}
