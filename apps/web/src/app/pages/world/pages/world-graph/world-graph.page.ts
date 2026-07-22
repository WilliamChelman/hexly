import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { WorldGraph as WorldGraphPayload } from '@hexly/domain';
import { ActiveWorld, entityRoute, ToasterService, WorldsClient } from '@hexly/web-core';
import { EyebrowComponent, PageHeaderComponent, PanelComponent } from '@hexly/web-ui';
import { GraphCanvasComponent, GraphOpen } from './components/graph-canvas.component';
import { orphanIds, withoutOrphans } from './utils/orphans';

/**
 * The World Graph page at `/w/:worldId/graph`: the World's readable Entities as nodes, their Entity
 * Links as edges. The endpoint has already dropped every Entity and every edge this viewer may not
 * see, so nothing here filters.
 *
 * The whole World arrives in one payload and stays in memory for the life of the page; a `world`
 * nudge says nothing about whether an Entity's links moved, so the graph refreshes on open only.
 */
@Component({
  selector: 'app-world-graph',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, EyebrowComponent, PageHeaderComponent, PanelComponent, GraphCanvasComponent],
  host: { class: 'flex flex-col h-full bg-surface-sunken' },
  template: `
    <app-page-header sticky>
      <div pageHeaderTitle class="flex flex-col">
        <span appEyebrow class="text-gold! tracking-[0.28em]">{{ 'worldGraph.eyebrow' | transloco }}</span>
        <h1 class="font-display text-[22px] text-ink-strong m-0 leading-tight">
          {{ worldName() }}
        </h1>
      </div>
      @if (visibleGraph(); as g) {
        <div pageHeaderActions class="flex items-center gap-4">
          <span class="text-sm text-ink-muted" data-testid="graph-counts">
            {{ 'worldGraph.counts' | transloco: { nodes: g.nodes.length, edges: g.edges.length } }}
          </span>
          @if (orphanCount(); as orphans) {
            <button
              type="button"
              [attr.aria-pressed]="showOrphans()"
              class="font-sans text-sm text-ink-strong px-2 py-1 rounded-sm hover:bg-surface-sunken aria-pressed:bg-gold/15 aria-pressed:text-gold"
              data-testid="graph-orphans-toggle"
              (click)="showOrphans.set(!showOrphans())"
            >
              {{ 'worldGraph.showOrphans' | transloco: { count: orphans } }}
            </button>
          }
        </div>
      }
    </app-page-header>

    <main class="flex-1 min-h-0 p-6">
      @if (isEmpty()) {
        <section
          class="h-full flex flex-col items-center justify-center gap-3 text-center text-ink-muted"
          data-testid="graph-empty"
          appPanel
        >
          <p class="m-0 font-display text-lg text-ink-strong">
            {{ 'worldGraph.emptyTitle' | transloco }}
          </p>
          <p class="text-sm m-0">{{ 'worldGraph.emptyHint' | transloco }}</p>
        </section>
      } @else if (allHidden()) {
        <section
          class="h-full flex flex-col items-center justify-center gap-3 text-center text-ink-muted"
          data-testid="graph-all-orphans"
          appPanel
        >
          <p class="m-0 font-display text-lg text-ink-strong">
            {{ 'worldGraph.allOrphansTitle' | transloco }}
          </p>
          <p class="text-sm m-0">{{ 'worldGraph.allOrphansHint' | transloco: { count: orphanCount() } }}</p>
        </section>
      } @else if (visibleGraph(); as g) {
        <div class="h-full overflow-hidden" appPanel>
          <app-graph-canvas [graph]="g" (open)="openEntity($event)" />
        </div>
      }
    </main>
  `,
})
export class WorldGraphPage {
  private readonly worlds = inject(WorldsClient);
  private readonly activeWorld = inject(ActiveWorld);
  private readonly router = inject(Router);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);

  protected readonly worldName = this.activeWorld.name;
  protected readonly graph = signal<WorldGraphPayload | null>(null);
  /**
   * The show-orphans toggle, default off (ADR-0065): unlinked Entities of any type — chiefly
   * bulk-minted Assets — stay out of the picture until the reader asks for them. Generic, no
   * per-type rule. Filtering rides the client: the whole World is already in memory, so a flip is
   * instant and never re-fetches.
   */
  protected readonly showOrphans = signal(false);
  /** How many nodes the toggle would reveal; `0` hides the toggle — nothing to show. */
  protected readonly orphanCount = computed(() => {
    const g = this.graph();
    return g ? orphanIds(g).size : 0;
  });
  /** The graph as drawn: orphans dropped unless the toggle is on. */
  protected readonly visibleGraph = computed(() => {
    const g = this.graph();
    if (!g) return null;
    return this.showOrphans() ? g : withoutOrphans(g);
  });
  /** Gates the empty state on a resolved read, so it never flashes before the payload lands. */
  protected readonly isEmpty = computed(() => this.graph()?.nodes.length === 0);
  /** Every node is an orphan and the toggle is off — a whole World hidden, not an empty one. */
  protected readonly allHidden = computed(() => !this.isEmpty() && this.visibleGraph()?.nodes.length === 0);

  constructor() {
    const worldId = this.activeWorld.worldId();
    if (!worldId) return; // activeWorldGuard pins it before this page renders.
    this.worlds.graph(worldId).subscribe({
      next: (graph) => this.graph.set(graph),
      error: () => this.toaster.show(this.transloco.translate('worldGraph.loadError'), 'error'),
    });
  }

  /** A Ctrl/Cmd (or middle) click opens the Entity in a new tab, as the modifier does on any link. */
  protected openEntity({ id, newTab }: GraphOpen): void {
    const worldId = this.activeWorld.worldId();
    if (!worldId) return;
    const name = this.graph()?.nodes.find((n) => n.id === id)?.name;
    const route = entityRoute(worldId, id, this.worldName() ?? undefined, name);
    if (newTab) {
      const url = this.router.serializeUrl(this.router.createUrlTree(route));
      window.open(url, '_blank', 'noopener');
      return;
    }
    void this.router.navigate(route);
  }
}
