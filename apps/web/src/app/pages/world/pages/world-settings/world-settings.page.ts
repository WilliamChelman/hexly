import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map, switchMap } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ActiveWorld, ClientConfigStore, TitleService } from '@hexly/web-core';
import { EyebrowComponent, PanelComponent, IconComponent, IconName } from '@hexly/web-ui';
import { OwnerSetComponent, MemberSetComponent } from '@hexly/web-entity';
import { WorldTypesPanelComponent } from './components/world-types-panel.component';
import { WorldFieldsPanelComponent } from './components/world-fields-panel.component';
import { WorldImportsPanelComponent } from './components/world-imports-panel.component';
import { WorldMountsPanelComponent } from './components/world-mounts-panel.component';
import { WorldThemePanelComponent } from './components/world-theme-panel.component';
import { WorldKindPanelComponent } from './components/world-kind-panel.component';
import { WorldOpenPanelComponent } from './components/world-open-panel.component';

type Section = 'access' | 'kind' | 'schema' | 'mounts' | 'theme' | 'imports' | 'sharing';

interface SectionItem {
  readonly section: Section;
  readonly icon: IconName;
  readonly label: string;
}

/**
 * The World settings page: a master/detail layout whose in-page rail navigates between setting
 * groups so only one is on screen at a time, rather than a single long scroll. The active World id
 * comes from {@link ActiveWorld}, pinned by the `w/:worldId` resolver (ADR-0028). Every surface is
 * Owner-only (ADR-0039): a non-Owner who reaches this page sees load errors, not controls. Resigning
 * can cost the user reach to this World, so it drops back to the World Index.
 *
 * With Collaboration off (ADR-0071) the rail carries only the schema and imports groups.
 *
 * The open group lives in the URL's `section` param, so a refresh or a shared link lands on the same
 * pane rather than the top of the rail — and names the tab title with it (ADR-0014).
 */
@Component({
  selector: 'app-world-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslocoPipe,
    EyebrowComponent,
    PanelComponent,
    IconComponent,
    OwnerSetComponent,
    MemberSetComponent,
    WorldTypesPanelComponent,
    WorldFieldsPanelComponent,
    WorldImportsPanelComponent,
    WorldMountsPanelComponent,
    WorldThemePanelComponent,
    WorldKindPanelComponent,
    WorldOpenPanelComponent,
  ],
  template: `
    @if (worldId(); as id) {
      <div class="layout">
        <nav class="rail" [attr.aria-label]="'nav.settingsSections' | transloco">
          <span appEyebrow class="rail-eyebrow">{{ 'nav.worldSettings' | transloco }}</span>
          @for (item of items(); track item.section) {
            <button
              type="button"
              class="rail-item"
              [class.is-active]="active() === item.section"
              [attr.data-testid]="'settings-nav-' + item.section"
              (click)="select(item.section)"
            >
              <app-icon [name]="item.icon" [size]="18" />
              <span>{{ item.label | transloco }}</span>
            </button>
          }
        </nav>

        <section class="detail">
          @switch (active()) {
            @case ('access') {
              <header class="detail-head">
                <h1 class="detail-title">
                  {{ 'collab.owners.heading' | transloco }} & {{ 'collab.members.heading' | transloco }}
                </h1>
                <p class="detail-sub">
                  {{ 'collab.owners.subhead' | transloco: { kind: 'collab.owners.world' | transloco } }}
                </p>
              </header>
              <div class="pane" appPanel><app-owner-set kind="world" [id]="id" (resigned)="leave()" /></div>
              <h2 class="group-head">{{ 'collab.members.heading' | transloco }}</h2>
              <div class="pane" appPanel><app-member-set [id]="id" /></div>
            }
            @case ('kind') {
              <header class="detail-head">
                <h1 class="detail-title">{{ 'worldKind.heading' | transloco }}</h1>
                <p class="detail-sub">{{ 'worldKind.subhead' | transloco }}</p>
              </header>
              <div class="pane" appPanel><app-world-kind [id]="id" /></div>
            }
            @case ('schema') {
              <header class="detail-head">
                <h1 class="detail-title">{{ 'worldTypes.heading' | transloco }}</h1>
                <p class="detail-sub">{{ 'worldTypes.subhead' | transloco }}</p>
              </header>
              <div class="pane" appPanel><app-world-types [id]="id" /></div>
              <h2 class="group-head">{{ 'worldFields.heading' | transloco }}</h2>
              <p class="detail-sub">{{ 'worldFields.subhead' | transloco }}</p>
              <div class="pane" appPanel><app-world-fields [id]="id" /></div>
            }
            @case ('mounts') {
              <header class="detail-head">
                <h1 class="detail-title">{{ 'mounts.heading' | transloco }}</h1>
                <p class="detail-sub">{{ 'mounts.subhead' | transloco }}</p>
              </header>
              <div class="pane" appPanel><app-world-mounts [id]="id" /></div>
            }
            @case ('theme') {
              <header class="detail-head">
                <h1 class="detail-title">{{ 'worldTheme.heading' | transloco }}</h1>
                <p class="detail-sub">{{ 'worldTheme.subhead' | transloco }}</p>
              </header>
              <div class="pane" appPanel><app-world-theme [id]="id" /></div>
            }
            @case ('imports') {
              <header class="detail-head">
                <h1 class="detail-title">{{ 'imports.heading' | transloco }}</h1>
                <p class="detail-sub">{{ 'imports.subhead' | transloco }}</p>
              </header>
              <div class="pane" appPanel><app-world-imports [id]="id" /></div>
            }
            @case ('sharing') {
              <!-- The Open-World toggle (ADR-0084), the successor to the retired World Public Link: a
                   World management power, gated in the rail on the same manage right the Theme/Mounts
                   panels are and on the Collaboration layer (ADR-0071). -->
              <header class="detail-head">
                <h1 class="detail-title">{{ 'worldOpen.heading' | transloco }}</h1>
                <p class="detail-sub">{{ 'worldOpen.subhead' | transloco }}</p>
              </header>
              <div class="pane" appPanel><app-world-open [id]="id" /></div>
            }
          }
        </section>
      </div>
    }
  `,
  styles: `
    @reference '#app-styles.css';
    .layout {
      @apply mx-auto grid w-full max-w-5xl gap-8 p-8;
      grid-template-columns: 15rem 1fr;
    }
    .rail {
      @apply flex flex-col gap-1 self-start;
      position: sticky;
      top: 1.5rem;
    }
    .rail-eyebrow {
      @apply mb-2 px-3;
    }
    .rail-item {
      @apply flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-ink-muted;
    }
    .rail-item:hover {
      @apply bg-surface text-ink-strong;
    }
    .rail-item.is-active {
      @apply bg-surface-raised font-medium text-ink-strong shadow-1;
    }
    .detail {
      @apply flex min-w-0 flex-col gap-3;
    }
    .detail-title {
      @apply font-display text-2xl text-ink-strong;
    }
    .detail-sub {
      @apply text-sm text-ink-muted;
    }
    .group-head {
      @apply mt-4 font-display text-lg text-ink-strong;
    }
    .pane {
      @apply p-5;
    }
  `,
})
export class WorldSettingsPage {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly clientConfig = inject(ClientConfigStore);
  private readonly activeWorld = inject(ActiveWorld);
  readonly worldId = this.activeWorld.worldId;

  /**
   * Whether the caller may manage the World (ADR-0039) — the right the Theme/Mounts/Kind panels and the
   * Open-World toggle (ADR-0084) all gate on, so the page never shows a control the server would refuse.
   */
  readonly canManage = computed(() => !!this.activeWorld.world()?.rights?.includes('manage'));

  readonly items = computed<readonly SectionItem[]>(() => {
    const collaboration = this.clientConfig.isCollaborationEnabled();
    // A Theme is authored, not read: only a caller who may manage the World gets the editor (ADR-0039),
    // the same right the rail gates this whole page on.
    const canManage = this.canManage();
    return [
      ...(collaboration
        ? [{ section: 'access' as const, icon: 'user' as const, label: 'collab.members.heading' }]
        : []),
      { section: 'schema' as const, icon: 'label' as const, label: 'worldTypes.heading' },
      // Campaign-or-Shelf is a curation the World Owner alone makes (ADR-0080), gated on the same
      // right the Theme editor is — and never first, so the group Settings opens on is unchanged.
      ...(canManage ? [{ section: 'kind' as const, icon: 'globe' as const, label: 'worldKind.heading' }] : []),
      // Declaring what this World draws from is the Owner's alone (ADR-0080), and the whole Mount
      // surface is Owner-gated server-side — so it rides the same `manage` right the Theme does.
      ...(canManage ? [{ section: 'mounts' as const, icon: 'library' as const, label: 'mounts.heading' }] : []),
      ...(canManage ? [{ section: 'theme' as const, icon: 'palette' as const, label: 'worldTheme.heading' }] : []),
      { section: 'imports' as const, icon: 'download' as const, label: 'imports.heading' },
      // The Open-World toggle is the only sharing surface left (ADR-0084): Owner-gated like the Theme,
      // and cut with the Collaboration layer (ADR-0071), so the group shows only for a manager with it on.
      ...(collaboration && canManage
        ? [{ section: 'sharing' as const, icon: 'share' as const, label: 'worldOpen.heading' }]
        : []),
    ];
  });

  private readonly routedSection = toSignal(this.route.queryParamMap.pipe(map((q) => q.get('section'))));

  /**
   * The open group: whatever the URL names, narrowed to {@link items} so a section the rail does not
   * carry — cut by config or by rights, or simply a stale link — falls back to the first one rather
   * than showing an empty detail. The fallback only reads the rail, so a World refresh (saving a Theme
   * re-pins one) leaves the URL, and the open pane, alone.
   */
  readonly active = computed<Section>(() => {
    const sections = this.items().map((item) => item.section);
    const routed = this.routedSection();
    return sections.find((section) => section === routed) ?? sections[0];
  });

  constructor() {
    const transloco = inject(TranslocoService);
    const titles = inject(TitleService);
    // The tab reads "Hexly — World theme": the open group's own rail label names it, so the two
    // cannot drift, and selectTranslate re-resolves it on a live language switch (ADR-0014).
    const label = toSignal(
      toObservable(computed(() => this.items().find((item) => item.section === this.active())?.label)).pipe(
        switchMap((key) => (key ? transloco.selectTranslate(key) : [null])),
      ),
    );
    effect(() => titles.setDocumentName(label() ?? null));
    // A stale section name would otherwise shadow the next page's title.
    inject(DestroyRef).onDestroy(() => titles.setDocumentName(null));
  }

  /** Open a group by putting it in the URL, replacing rather than stacking so Back leaves the page. */
  select(section: Section): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { section },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  leave(): void {
    this.router.navigate(['/']);
  }
}
