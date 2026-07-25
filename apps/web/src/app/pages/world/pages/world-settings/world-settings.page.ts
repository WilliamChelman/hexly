import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { ActiveWorld, ClientConfigStore } from '@hexly/web-core';
import { EyebrowComponent, PanelComponent, IconComponent, IconName } from '@hexly/web-ui';
import { OwnerSetComponent, MemberSetComponent, PublicLinkComponent } from '@hexly/web-entity';
import { WorldTypesPanelComponent } from './components/world-types-panel.component';
import { WorldFieldsPanelComponent } from './components/world-fields-panel.component';
import { WorldImportsPanelComponent } from './components/world-imports-panel.component';

type Section = 'access' | 'schema' | 'imports' | 'sharing';

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
    PublicLinkComponent,
    WorldTypesPanelComponent,
    WorldFieldsPanelComponent,
    WorldImportsPanelComponent,
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
              (click)="active.set(item.section)"
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
            @case ('imports') {
              <header class="detail-head">
                <h1 class="detail-title">{{ 'imports.heading' | transloco }}</h1>
                <p class="detail-sub">{{ 'imports.subhead' | transloco }}</p>
              </header>
              <div class="pane" appPanel><app-world-imports [id]="id" /></div>
            }
            @case ('sharing') {
              <header class="detail-head">
                <h1 class="detail-title">{{ 'collab.publicLink.worldHeading' | transloco }}</h1>
                <p class="detail-sub">{{ 'collab.publicLink.worldSubhead' | transloco }}</p>
              </header>
              <div class="pane" appPanel><app-public-link kind="world" [id]="id" /></div>
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
  private readonly clientConfig = inject(ClientConfigStore);
  readonly worldId = inject(ActiveWorld).worldId;

  readonly items = computed<readonly SectionItem[]>(() => {
    const collaboration = this.clientConfig.isCollaborationEnabled();
    return [
      ...(collaboration
        ? [{ section: 'access' as const, icon: 'user' as const, label: 'collab.members.heading' }]
        : []),
      { section: 'schema' as const, icon: 'label' as const, label: 'worldTypes.heading' },
      { section: 'imports' as const, icon: 'download' as const, label: 'imports.heading' },
      ...(collaboration
        ? [{ section: 'sharing' as const, icon: 'share' as const, label: 'collab.publicLink.worldHeading' }]
        : []),
    ];
  });

  /** The open group; derived from {@link items} so a cut section can never stay selected. */
  readonly active = linkedSignal<Section>(() => this.items()[0].section);

  leave(): void {
    this.router.navigate(['/']);
  }
}
