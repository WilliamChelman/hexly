import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { WorldGraph as WorldGraphPayload } from '@hexly/domain';
import { ActiveWorld, entityRoute, ToasterService, WorldsClient } from '@hexly/web-core';
import {
  ButtonComponent,
  EyebrowComponent,
  IconComponent,
  MenuItemCheckboxDirective,
  MenuPanelDirective,
  MenuTriggerDirective,
  PageHeaderComponent,
  PanelComponent,
} from '@hexly/web-ui';
import {
  decorEdgeCount,
  GraphCanvasComponent,
  GraphWarmPool,
  GraphOpen,
  openEntityRoute,
  orphanIds,
  withoutDecorEdges,
  withoutOrphans,
} from '@hexly/web-entity';

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
  imports: [
    TranslocoPipe,
    ButtonComponent,
    EyebrowComponent,
    IconComponent,
    MenuTriggerDirective,
    MenuPanelDirective,
    MenuItemCheckboxDirective,
    PageHeaderComponent,
    PanelComponent,
    GraphCanvasComponent,
  ],
  host: { class: 'flex flex-col h-full bg-surface-sunken' },
  template: `
    <app-page-header sticky>
      <div pageHeaderTitle class="flex flex-col">
        <span appEyebrow class="text-accent-strong! tracking-[0.28em]">{{ 'worldGraph.eyebrow' | transloco }}</span>
        <h1 class="font-display text-[22px] text-ink-strong m-0 leading-tight">
          {{ worldName() }}
        </h1>
      </div>
      @if (visibleGraph(); as g) {
        <div pageHeaderActions class="flex items-center gap-4">
          <span class="text-sm text-ink-muted" data-testid="graph-counts">
            {{ 'worldGraph.counts' | transloco: { nodes: ownNodeCount(), edges: g.edges.length } }}
          </span>
        </div>
      }
    </app-page-header>

    <main class="relative flex-1 min-h-0 p-6">
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

      <!-- The filters float over the graph's top-right corner rather than sitting in the page header:
           they belong to the drawing, and the header shouldn't grow a control per filter we add. A
           sibling of the panel (never a child) — the canvas panel is overflow-hidden. -->
      @if (hasFilters()) {
        <button
          type="button"
          appButton
          size="sm"
          icon
          class="absolute top-9 right-9 z-10"
          data-testid="graph-filters"
          [appMenuTrigger]="filtersMenu"
          [title]="'worldGraph.filters' | transloco"
          [attr.aria-label]="'worldGraph.filters' | transloco"
        >
          <app-icon name="settings" [size]="16" />
        </button>
      }
    </main>

    <ng-template #filtersMenu>
      <div appMenuPanel>
        @if (decorCount(); as decor) {
          <button
            type="button"
            appMenuItemCheckbox
            data-testid="graph-decor-toggle"
            [checked]="showDecor()"
            (triggered)="showDecor.set(!showDecor())"
          >
            {{ 'worldGraph.showDecor' | transloco: { count: decor } }}
          </button>
        }
        @if (orphanCount(); as orphans) {
          <button
            type="button"
            appMenuItemCheckbox
            data-testid="graph-orphans-toggle"
            [checked]="showOrphans()"
            (triggered)="showOrphans.set(!showOrphans())"
          >
            {{ 'worldGraph.showOrphans' | transloco: { count: orphans } }}
          </button>
        }
      </div>
    </ng-template>
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
  /**
   * The show-decor-links reveal, default off (ADR-0069): **Decor Links** (a Thumbnail designation, a
   * prose/Board image, a user "presentation only" link) are presentation, not worldbuilding relations,
   * so they stay hidden until the reader peeks. Ephemeral by decision — never persisted. Rides the
   * client like the orphans toggle: the whole World is in memory, so a flip is instant and never
   * re-fetches. The server has already access-filtered both endpoints, so this filter only narrows
   * *presentation*, never what the viewer may see.
   */
  protected readonly showDecor = signal(false);
  /** How many edges the decor toggle would reveal; `0` hides the toggle — no decor to show. */
  protected readonly decorCount = computed(() => {
    const g = this.graph();
    return g ? decorEdgeCount(g) : 0;
  });
  /**
   * The graph with Decor Links resolved: dropped unless the decor toggle is on. Orphan computation and
   * the drawn graph both derive from *this*, so decor filtering runs **before** orphan detection — an
   * Asset whose only edges are decor becomes an ordinary orphan and hides under the orphans toggle.
   */
  private readonly decorResolved = computed(() => {
    const g = this.graph();
    if (!g) return null;
    return this.showDecor() ? g : withoutDecorEdges(g);
  });
  /** How many nodes the orphans toggle would reveal, given the current decor visibility; `0` hides it. */
  protected readonly orphanCount = computed(() => {
    const g = this.decorResolved();
    return g ? orphanIds(g).size : 0;
  });
  /** The graph as drawn: decor filtered first, then orphans dropped unless the orphans toggle is on. */
  protected readonly visibleGraph = computed(() => {
    const g = this.decorResolved();
    if (!g) return null;
    return this.showOrphans() ? g : withoutOrphans(g);
  });
  /**
   * The count pill's node figure: this World's own nodes, **Foreign nodes** excluded (ADR-0080). They
   * are drawn but never counted — a World's counts stay its own, so mounting a large pack does not
   * restate how big this World is.
   */
  protected readonly ownNodeCount = computed(
    () => this.visibleGraph()?.nodes.filter((n) => !n.foreignContainerId).length ?? 0,
  );
  /**
   * Whether the filters menu has anything to offer — its trigger stays away otherwise, the way each
   * toggle used to hide on a `0` count. Read off both counts, so a World with neither decor nor
   * orphans shows a bare graph.
   */
  protected readonly hasFilters = computed(() => this.decorCount() > 0 || this.orphanCount() > 0);
  /**
   * The Containers this World **Mounts** that are themselves Worlds (ADR-0080). A Foreign node carries a
   * raw Container id and the payload never says which kind it is, so this answers the one question a
   * click has: only a World may stand in a `:worldId` segment (ADR-0028). Empty until read — and read
   * only where there is a Foreign node to place.
   */
  private readonly mountedWorlds = signal<ReadonlySet<string>>(new Set());
  /** Gates the empty state on a resolved read, so it never flashes before the payload lands. */
  protected readonly isEmpty = computed(() => this.graph()?.nodes.length === 0);
  /** Every node is an orphan and the toggle is off — a whole World hidden, not an empty one. */
  protected readonly allHidden = computed(() => !this.isEmpty() && this.visibleGraph()?.nodes.length === 0);

  constructor() {
    // Warm the drawing while the payload is in flight (GraphWarmPool).
    inject(GraphWarmPool).warmUp();

    const worldId = this.activeWorld.worldId();
    if (!worldId) return; // activeWorldGuard pins it before this page renders.
    this.worlds.graph(worldId).subscribe({
      next: (graph) => {
        this.graph.set(graph);
        if (graph.nodes.some((n) => n.foreignContainerId)) this.readMounts(worldId);
      },
      error: () => this.toaster.show(this.transloco.translate('worldGraph.loadError'), 'error'),
    });
  }

  /**
   * The Mount set, read for its `kind` alone (ADR-0080). Failure is silent, refusal included — the read
   * is member-gated, and a reader here through someone else's Mount is no member: every Foreign node then
   * opens under the World on screen, which costs a redirect hop and never a broken route.
   */
  private readMounts(worldId: string): void {
    this.worlds.mounts(worldId).subscribe({
      next: (mounts) =>
        this.mountedWorlds.set(new Set(mounts.filter((m) => m.kind === 'world').map((m) => m.containerId))),
      error: () => undefined,
    });
  }

  /**
   * Open the clicked node. Entity URLs are World-scoped (ADR-0028), so a **Foreign node** in a mounted
   * World routes to *that* World — this page's would be the wrong shell around it (ADR-0080).
   *
   * A **Compendium** is no World, and neither is a Container this World does not Mount — **Adoption**
   * copies links verbatim, so those exist. Their entries open under the World on screen, the way the
   * Library's cards and Quick Open open a **Sealed** one (ADR-0079): the segment is navigation context,
   * and `reconcileWorldSegment` corrects it for a target that has a World of its own.
   */
  protected openEntity({ id, newTab }: GraphOpen): void {
    const node = this.graph()?.nodes.find((n) => n.id === id);
    const foreign = node?.foreignContainerId;
    const worldId = this.activeWorld.worldId();
    const home = foreign && this.mountedWorlds().has(foreign) ? foreign : worldId;
    if (!home) return;
    // Only this World's own name is known here; a Foreign World goes by bare id and `activeWorldGuard`
    // heals the slug once the route lands.
    const containerName = home === worldId ? (this.worldName() ?? undefined) : undefined;
    openEntityRoute(this.router, entityRoute(home, id, containerName, node?.name), newTab);
  }
}
