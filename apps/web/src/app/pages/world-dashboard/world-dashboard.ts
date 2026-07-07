import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { EntityFacets, EntitySummary, EntityType } from '@hexly/domain';
import { EntitiesClient } from '../../core/services/entities.client';
import { WorldsClient } from '../../core/services/worlds.client';
import { ActiveWorld } from '../../core/services/active-world';
import { ToasterService } from '../../core/services/toaster.service';
import { HexlyDatePipe } from '../../core/i18n/hexly-date.pipe';
import { entityRoute, worldRoute } from '../../core/utils/routes';
import { Button } from '../../ui/button';
import { Eyebrow } from '../../ui/eyebrow';
import { Panel } from '../../ui/panel';
import { PageHeader } from '../../ui/page-header';
import { Icon, IconName } from '../../ui/icon/icon';
import { EntitySearchPicker } from '../../ui/entity-search-picker';
import { ACCENT_BAR, accentFor } from '../../ui/sigil';

/** How many recent Entities / Hex Maps the Dashboard surfaces at a glance. */
const RECENTS_LIMIT = 8;
const MAPS_LIMIT = 8;

/**
 * The World Dashboard (ADR-0043, CONTEXT.md → World Dashboard): the per-World
 * landing surface at `/w/:worldId`. A read-only *derived* view — it authors
 * nothing, only queries the existing list/facets endpoints over this World's
 * Entities: recents (most-recently-edited), Hex Maps, and at-a-glance Type counts,
 * with a link to the full Entity Browser. A brand-new empty World gets a purposeful
 * empty state that creates the first Note or Hex Map, not a blank page. Pins come
 * in a later slice. The active World is pinned by the `w/:worldId` guard (ADR-0028).
 */
@Component({
  selector: 'app-world-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgTemplateOutlet,
    RouterLink,
    TranslocoPipe,
    HexlyDatePipe,
    Button,
    Eyebrow,
    Panel,
    PageHeader,
    Icon,
    EntitySearchPicker,
  ],
  host: { class: 'block min-h-full bg-surface-sunken' },
  template: `
    <!-- One tile template, placed by both the recents and the maps grid. The
         data-testid prefix distinguishes them so a hex map showing in both lists
         keeps a distinct selector per section. -->
    <ng-template #tile let-e let-prefix="prefix">
      <section
        class="group relative flex gap-3 p-4 pl-5 overflow-hidden h-full transition-shadow hover:shadow-3 has-[a:focus-visible]:[outline:2px_solid_var(--color-gold)] has-[a:focus-visible]:outline-offset-2"
        appPanel
        raised
      >
        <span class="absolute left-0 top-0 bottom-0 w-1.5 {{ bar(e.id) }}"></span>
        <app-icon
          [name]="typeIcon(e.type)"
          [size]="18"
          class="shrink-0 mt-0.5 text-ink-muted"
        />
        <div class="min-w-0 flex-1">
          <a
            class="block no-underline outline-none focus-visible:shadow-none after:content-[''] after:absolute after:inset-0"
            [routerLink]="entityLink(e)"
            [attr.data-testid]="prefix + '-' + e.id"
            [attr.aria-label]="e.name"
          >
            <span
              class="font-display text-md text-ink-strong leading-tight line-clamp-2 group-hover:text-gold transition-colors"
              >{{ e.name }}</span
            >
          </a>
          <span class="mt-1 block text-2xs text-ink-muted">
            {{ 'entityBrowser.type.' + e.type | transloco }}
            <span class="text-ink-faint">·</span>
            {{ 'entityBrowser.edited' | transloco: { date: (e.updatedAt | hexlyDate) } }}
          </span>
        </div>
      </section>
    </ng-template>

    <app-page-header sticky>
      <div pageHeaderTitle class="flex flex-col">
        <span appEyebrow class="text-gold! tracking-[0.28em]">{{
          'worldDashboard.eyebrow' | transloco
        }}</span>
        <h1 class="font-display text-[22px] text-ink-strong m-0 leading-tight">
          {{ worldName() }}
        </h1>
      </div>
      @if (!isEmpty()) {
        <a
          pageHeaderActions
          appButton
          variant="default"
          [routerLink]="browseAllLink()"
          data-testid="browse-all"
        >
          <app-icon name="library" [size]="16" />
          {{ 'worldDashboard.browseAll' | transloco }}
        </a>
      }
    </app-page-header>

    <main class="max-w-[72rem] mx-auto py-8 px-6 flex flex-col gap-10">
      @if (isEmpty()) {
        <section
          class="p-16 text-center text-ink-muted flex flex-col items-center gap-3"
          data-testid="dashboard-empty"
          appPanel
        >
          <p class="m-0 font-display text-lg text-ink-strong">
            {{ 'worldDashboard.emptyTitle' | transloco }}
          </p>
          <p class="text-sm m-0">{{ 'worldDashboard.emptyHint' | transloco }}</p>
          <div class="flex items-center gap-2 mt-1">
            <button
              type="button"
              appButton
              variant="default"
              data-testid="create-note"
              [disabled]="creating()"
              (click)="create('note')"
            >
              <app-icon name="plus" [size]="16" />
              {{ (creating() ? 'entityBrowser.creating' : 'entityBrowser.newNote') | transloco }}
            </button>
            <button
              type="button"
              appButton
              variant="primary"
              data-testid="create-map"
              [disabled]="creating()"
              (click)="create('hexmap')"
            >
              <app-icon name="plus" [size]="16" />
              {{ (creating() ? 'entityBrowser.creating' : 'entityBrowser.newMap') | transloco }}
            </button>
          </div>
        </section>
      } @else {
        @if (typeCounts().length > 0) {
          <section>
            <h2 appEyebrow mark class="mb-3">
              {{ 'worldDashboard.countsHeading' | transloco }}
            </h2>
            <ul class="flex flex-wrap gap-3 m-0 p-0 list-none">
              @for (c of typeCounts(); track c.value) {
                <li
                  class="flex items-baseline gap-2 px-4 py-3 min-w-32"
                  appPanel
                  [attr.data-testid]="'count-type-' + c.value"
                >
                  <span class="font-display text-2xl text-ink-strong">{{ c.count }}</span>
                  <span class="text-sm text-ink-muted">{{
                    'entityBrowser.type.' + c.value | transloco
                  }}</span>
                </li>
              }
            </ul>
          </section>
        }

        @if (pins().length > 0 || canCurate()) {
          <section>
            <div class="mb-3 flex items-center gap-3">
              <h2 appEyebrow mark class="m-0">
                {{ 'worldDashboard.pinsHeading' | transloco }}
              </h2>
              @if (canCurate()) {
                <button
                  type="button"
                  appButton
                  variant="ghost"
                  size="sm"
                  data-testid="add-pin"
                  (click)="togglePinPicker()"
                >
                  <app-icon name="plus" [size]="14" />
                  {{ 'worldDashboard.addPin' | transloco }}
                </button>
              }
            </div>

            @if (pinPickerOpen()) {
              <div class="mb-4 max-w-sm">
                <app-entity-search-picker
                  testid="pin-picker"
                  [worldId]="activeWorldId() ?? undefined"
                  [query]="pinQuery()"
                  (queryChange)="pinQuery.set($event)"
                  (pick)="addPin($event)"
                />
              </div>
            }

            <ul
              class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 m-0 p-0 list-none"
            >
              @for (e of pins(); track e.id; let i = $index) {
                <li class="relative">
                  <ng-container
                    [ngTemplateOutlet]="tile"
                    [ngTemplateOutletContext]="{ $implicit: e, prefix: 'pin' }"
                  />
                  @if (canCurate()) {
                    <!-- z-10 lifts the controls above the tile's full-card link overlay. -->
                    <div class="absolute top-2 right-2 z-10 flex gap-0.5">
                      <button
                        type="button"
                        appButton
                        variant="ghost"
                        size="sm"
                        icon
                        [disabled]="i === 0"
                        [attr.data-testid]="'move-pin-up-' + e.id"
                        [attr.aria-label]="'worldDashboard.movePinUp' | transloco"
                        [attr.title]="'worldDashboard.movePinUp' | transloco"
                        (click)="movePin(e.id, -1)"
                      >
                        <span aria-hidden="true">↑</span>
                      </button>
                      <button
                        type="button"
                        appButton
                        variant="ghost"
                        size="sm"
                        icon
                        [disabled]="i === pins().length - 1"
                        [attr.data-testid]="'move-pin-down-' + e.id"
                        [attr.aria-label]="'worldDashboard.movePinDown' | transloco"
                        [attr.title]="'worldDashboard.movePinDown' | transloco"
                        (click)="movePin(e.id, 1)"
                      >
                        <span aria-hidden="true">↓</span>
                      </button>
                      <button
                        type="button"
                        appButton
                        variant="ghost"
                        size="sm"
                        icon
                        danger
                        [attr.data-testid]="'remove-pin-' + e.id"
                        [attr.aria-label]="'worldDashboard.removePin' | transloco"
                        [attr.title]="'worldDashboard.removePin' | transloco"
                        (click)="removePin(e.id)"
                      >
                        <app-icon name="close" [size]="14" />
                      </button>
                    </div>
                  }
                </li>
              }
            </ul>
          </section>
        }

        <section>
          <h2 appEyebrow mark class="mb-3">
            {{ 'worldDashboard.recentsHeading' | transloco }}
          </h2>
          <ul
            class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 m-0 p-0 list-none"
          >
            @for (e of recents(); track e.id) {
              <li>
                <ng-container
                  [ngTemplateOutlet]="tile"
                  [ngTemplateOutletContext]="{ $implicit: e, prefix: 'recent' }"
                />
              </li>
            }
          </ul>
        </section>

        @if (maps().length > 0) {
          <section>
            <h2 appEyebrow mark class="mb-3">
              {{ 'worldDashboard.mapsHeading' | transloco }}
            </h2>
            <ul
              class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 m-0 p-0 list-none"
            >
              @for (e of maps(); track e.id) {
                <li>
                  <ng-container
                    [ngTemplateOutlet]="tile"
                    [ngTemplateOutletContext]="{ $implicit: e, prefix: 'map' }"
                  />
                </li>
              }
            </ul>
          </section>
        }
      }
    </main>
  `,
})
export class WorldDashboard {
  private readonly entitiesClient = inject(EntitiesClient);
  private readonly worldsClient = inject(WorldsClient);
  private readonly activeWorld = inject(ActiveWorld);
  private readonly router = inject(Router);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);

  protected readonly worldName = this.activeWorld.name;
  /** The active World id — scopes the pin picker so pins stay same-World (ADR-0024). */
  protected readonly activeWorldId = this.activeWorld.worldId;
  protected readonly recents = signal<EntitySummary[]>([]);
  protected readonly maps = signal<EntitySummary[]>([]);
  /** The resolved Pinned Entities, in `pinnedEntityIds` order (#168). */
  protected readonly pins = signal<EntitySummary[]>([]);
  /** Owner-only: the curation controls (add/reorder/remove) show only with `manage`. */
  protected readonly canCurate = computed(
    () => this.activeWorld.world()?.rights.includes('manage') ?? false,
  );
  /** Whether the add-pin search picker is open (Owner curation, #168). */
  protected readonly pinPickerOpen = signal(false);
  /** The pin picker's controlled query. */
  protected readonly pinQuery = signal('');
  /** The Type facet's live counts (note/hexmap), the Dashboard's at-a-glance tally. */
  protected readonly typeCounts = signal<EntityFacets['type']>([]);
  /** Set once the recents read resolves — gates the empty state so it never flashes pre-load. */
  protected readonly loaded = signal(false);
  protected readonly creating = signal(false);
  /** A loaded World with no Entities: show the purposeful empty state, not a blank page. */
  protected readonly isEmpty = computed(
    () => this.loaded() && this.recents().length === 0,
  );

  constructor() {
    const worldId = this.activeWorld.worldId();
    if (!worldId) return;
    this.entitiesClient
      .list({ worldId, limit: RECENTS_LIMIT })
      .subscribe((page) => {
        this.recents.set(page.items);
        this.loaded.set(true);
      });
    this.entitiesClient
      .list({ worldId, type: ['hexmap'], limit: MAPS_LIMIT })
      .subscribe((page) => this.maps.set(page.items));
    this.entitiesClient
      .facets({ worldId })
      .subscribe((facets) => this.typeCounts.set(facets.type));

    // Resolve the Owner-curated pins through the entity read path so the per-caller
    // access filter applies (#168): a pinned Entity the viewer can't reach drops out,
    // and pin order is restored client-side (the list read is access-order, not pin-order).
    // Re-runs when a curation PATCH re-pins the active World's Detail.
    effect((onCleanup) => {
      const ids = this.activeWorld.world()?.pinnedEntityIds ?? [];
      if (ids.length === 0) {
        this.pins.set([]);
        return;
      }
      // The client sizes an `ids` read to the id count, so no pin is dropped by the
      // default page size (the schema caps the pin set at ENTITY_LIST_MAX_LIMIT).
      const sub = this.entitiesClient.list({ ids: [...ids] }).subscribe((page) => {
        const byId = new Map(page.items.map((e) => [e.id, e]));
        this.pins.set(
          ids.map((id) => byId.get(id)).filter((e): e is EntitySummary => !!e),
        );
      });
      onCleanup(() => sub.unsubscribe());
    });
  }

  protected entityLink(e: EntitySummary): string[] {
    return entityRoute(e.worldId, e.id, this.activeWorld.name() ?? undefined, e.name);
  }

  /** The full Entity Browser for this World ("show me everything"). */
  protected browseAllLink(): string[] {
    return worldRoute(this.activeWorld.worldId()!, this.activeWorld.name() ?? undefined);
  }

  protected bar(id: string): string {
    return ACCENT_BAR[accentFor(id)];
  }

  /** A hex map reads as terrain, a note as a label — matching the Entity Browser card. */
  protected typeIcon(type: EntityType): IconName {
    return type === 'hexmap' ? 'terrain' : 'label';
  }

  /** Create the first Note or Hex Map from the empty state and open it (mirrors the Browser). */
  protected create(type: EntityType): void {
    if (this.creating()) return;
    this.creating.set(true);
    this.entitiesClient
      .create(
        this.transloco.translate(
          type === 'note' ? 'domain.untitledNote' : 'domain.untitledMap',
        ),
        type,
        this.activeWorld.worldId() ?? undefined,
      )
      .pipe(finalize(() => this.creating.set(false)))
      .subscribe({
        next: (entity) =>
          this.router.navigate(
            entityRoute(
              this.activeWorld.worldId()!,
              entity.id,
              this.activeWorld.name() ?? undefined,
            ),
          ),
        error: () =>
          this.toaster.show(
            this.transloco.translate('entityBrowser.createError'),
            'error',
          ),
      });
  }

  /** Open/close the add-pin search picker, resetting its query each time (#168). */
  protected togglePinPicker(): void {
    this.pinQuery.set('');
    this.pinPickerOpen.update((v) => !v);
  }

  /** Pin the chosen Entity by appending it to the set (a no-op if already pinned). */
  protected addPin(e: EntitySummary): void {
    this.pinPickerOpen.set(false);
    const ids = this.currentPinIds();
    if (ids.includes(e.id)) return;
    this.commitPins([...ids, e.id]);
  }

  /** Unpin an Entity by omitting its id from the set. */
  protected removePin(id: string): void {
    this.commitPins(this.currentPinIds().filter((x) => x !== id));
  }

  /** Reorder a pin by one slot (`-1` up, `+1` down); a no-op at the ends. */
  protected movePin(id: string, delta: number): void {
    const ids = this.currentPinIds();
    const i = ids.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    this.commitPins(ids);
  }

  /** The World's stored pin set (references, not the resolved cards) — the edit source. */
  private currentPinIds(): string[] {
    return [...(this.activeWorld.world()?.pinnedEntityIds ?? [])];
  }

  /**
   * Persist a new pin set wholesale (#168) and re-pin the active World from the returned
   * Detail so the pins re-resolve. Owner-only server-side; a failure toasts and leaves
   * the World's pins as they were.
   */
  private commitPins(pinnedEntityIds: string[]): void {
    const worldId = this.activeWorld.worldId();
    if (!worldId) return;
    this.worldsClient.setPins(worldId, pinnedEntityIds).subscribe({
      next: (detail) => this.activeWorld.set(detail),
      error: () =>
        this.toaster.show(
          this.transloco.translate('worldDashboard.pinError'),
          'error',
        ),
    });
  }
}
