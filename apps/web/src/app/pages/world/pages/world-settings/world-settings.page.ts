import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { ActiveWorld } from '@hexly/web-core';
import { Eyebrow, Panel, Icon, IconName, OwnerSet, MemberSet, PublicLinkControl } from '@hexly/web-ui';
import { WorldTypesPanel } from './components/world-types-panel.component';
import { WorldFieldsPanel } from './components/world-fields-panel.component';

type Section = 'access' | 'schema' | 'sharing';

/**
 * The World settings page: a master/detail layout whose in-page rail navigates between setting
 * groups so only one is on screen at a time, rather than a single long scroll. The active World id
 * comes from {@link ActiveWorld}, pinned by the `w/:worldId` resolver (ADR-0028). Every surface is
 * Owner-only (ADR-0039): a non-Owner who reaches this page sees load errors, not controls. Resigning
 * can cost the user reach to this World, so it drops back to the World Index.
 */
@Component({
  selector: 'app-world-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslocoPipe,
    Eyebrow,
    Panel,
    Icon,
    OwnerSet,
    MemberSet,
    PublicLinkControl,
    WorldTypesPanel,
    WorldFieldsPanel,
  ],
  template: `
    @if (worldId(); as id) {
      <div class="layout">
        <nav class="rail" [attr.aria-label]="'nav.settingsSections' | transloco">
          <span appEyebrow class="rail-eyebrow">{{ 'nav.worldSettings' | transloco }}</span>
          @for (item of items; track item.section) {
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
                  {{ 'ui.owners.heading' | transloco }} & {{ 'ui.members.heading' | transloco }}
                </h1>
                <p class="detail-sub">{{ 'ui.owners.subhead' | transloco: { kind: 'ui.owners.world' | transloco } }}</p>
              </header>
              <div class="pane" appPanel><app-owner-set kind="world" [id]="id" (resigned)="leave()" /></div>
              <h2 class="group-head">{{ 'ui.members.heading' | transloco }}</h2>
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
            @case ('sharing') {
              <header class="detail-head">
                <h1 class="detail-title">{{ 'ui.publicLink.worldHeading' | transloco }}</h1>
                <p class="detail-sub">{{ 'ui.publicLink.worldSubhead' | transloco }}</p>
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
export class WorldSettings {
  private readonly router = inject(Router);
  readonly worldId = inject(ActiveWorld).worldId;
  readonly active = signal<Section>('access');

  readonly items: { section: Section; icon: IconName; label: string }[] = [
    { section: 'access', icon: 'user', label: 'ui.members.heading' },
    { section: 'schema', icon: 'label', label: 'worldTypes.heading' },
    { section: 'sharing', icon: 'share', label: 'ui.publicLink.worldHeading' },
  ];

  leave(): void {
    this.router.navigate(['/']);
  }
}
