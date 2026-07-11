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
import { EntitiesClient, ActiveWorld, ToasterService, HexlyDatePipe, entityRoute, worldRoute } from '@hexly/web-core';
import { Button, Eyebrow, Panel, PageHeader, Icon, IconName, EntitySearchPicker, ACCENT_BAR, accentFor } from '@hexly/web-ui';
import { TypeRegistry } from '../../entity-types/type-registry';

const RECENTS_LIMIT = 8;
const MAPS_LIMIT = 8;

/**
 * The World Dashboard: the per-World landing at `/w/:worldId`. A read-only
 * *derived* view — it authors nothing, only queries the list/facets endpoints:
 * pins, recents, Hex Maps, and at-a-glance Type counts. An empty World gets a
 * purposeful empty state that creates the first Note or Hex Map.
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
    <!-- One tile template shared by the sections; the data-testid prefix keeps
         a distinct selector for an Entity showing in more than one list. -->
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
  private readonly activeWorld = inject(ActiveWorld);
  private readonly router = inject(Router);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);
  private readonly types = inject(TypeRegistry);

  protected readonly worldName = this.activeWorld.name;
  /** Scopes the pin picker so pins stay same-World. */
  protected readonly activeWorldId = this.activeWorld.worldId;
  protected readonly recents = signal<EntitySummary[]>([]);
  protected readonly maps = signal<EntitySummary[]>([]);
  /** The resolved Pinned Entities, in `pinnedEntityIds` order. */
  protected readonly pins = signal<EntitySummary[]>([]);
  protected readonly canCurate = computed(
    () => this.activeWorld.world()?.rights.includes('manage') ?? false,
  );
  protected readonly pinPickerOpen = signal(false);
  protected readonly pinQuery = signal('');
  protected readonly typeCounts = signal<EntityFacets['type']>([]);
  /** Set once the recents read resolves — gates the empty state so it never flashes pre-load. */
  protected readonly loaded = signal(false);
  protected readonly creating = signal(false);
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
      .list({ worldId, type: this.types.mapTypeIds(), limit: MAPS_LIMIT })
      .subscribe((page) => this.maps.set(page.items));
    this.entitiesClient
      .facets({ worldId })
      .subscribe((facets) => this.typeCounts.set(facets.type));

    // Resolve pins through the entity read path so the per-caller access filter
    // applies: an unreachable pinned Entity drops out, and pin order is restored
    // client-side (the list read isn't pin-ordered).
    effect((onCleanup) => {
      const ids = this.activeWorld.world()?.pinnedEntityIds ?? [];
      if (ids.length === 0) {
        this.pins.set([]);
        return;
      }
      // The client sizes an `ids` read to the id count, so no pin is dropped by
      // the default page size.
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

  protected browseAllLink(): string[] {
    return worldRoute(this.activeWorld.worldId()!, this.activeWorld.name() ?? undefined);
  }

  protected bar(id: string): string {
    return ACCENT_BAR[accentFor(id)];
  }

  protected typeIcon(type: EntityType): IconName {
    return this.types.resolve(type).icon;
  }

  protected create(type: EntityType): void {
    if (this.creating()) return;
    this.creating.set(true);
    this.entitiesClient
      .create(
        this.transloco.translate(this.types.resolve(type).labels.untitled),
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

  protected togglePinPicker(): void {
    this.pinQuery.set('');
    this.pinPickerOpen.update((v) => !v);
  }

  protected addPin(e: EntitySummary): void {
    this.pinPickerOpen.set(false);
    const ids = this.currentPinIds();
    if (ids.includes(e.id)) return;
    this.activeWorld.commitPins([...ids, e.id]);
  }

  protected removePin(id: string): void {
    this.activeWorld.commitPins(this.currentPinIds().filter((x) => x !== id));
  }

  protected movePin(id: string, delta: number): void {
    const ids = this.currentPinIds();
    const i = ids.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    this.activeWorld.commitPins(ids);
  }

  private currentPinIds(): string[] {
    return [...(this.activeWorld.world()?.pinnedEntityIds ?? [])];
  }
}
