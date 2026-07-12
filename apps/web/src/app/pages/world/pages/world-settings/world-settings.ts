import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { ActiveWorld } from '@hexly/web-core';
import { Eyebrow, Panel, OwnerSet, MemberSet, PublicLinkControl } from '@hexly/web-ui';
import { WorldTypesPanel } from './world-types-panel';

/**
 * The World settings page (#158, #159): the World's symmetric owner set (view, add,
 * remove, resign) and, below it, the non-owner membership set (add/change-role/remove
 * Contributors and World Viewers). The active World id comes from {@link ActiveWorld},
 * pinned by the `w/:worldId` resolver (ADR-0028). Both surfaces are Owner-only, so a
 * non-Owner who reaches this page sees load errors rather than management controls.
 * Resigning can cost the user reach to this World, so it drops back to the World Index.
 */
@Component({
  selector: 'app-world-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, Eyebrow, Panel, OwnerSet, MemberSet, PublicLinkControl, WorldTypesPanel],
  template: `
    @if (worldId(); as id) {
      <section class="world-settings">
        <span appEyebrow>{{ 'ui.owners.heading' | transloco }}</span>
        <h1 class="world-settings-heading">
          {{ 'ui.owners.heading' | transloco }}
        </h1>
        <p class="world-settings-subhead">
          {{ 'ui.owners.subhead' | transloco: { kind: 'ui.owners.world' | transloco } }}
        </p>
        <div appPanel>
          <app-owner-set kind="world" [id]="id" (resigned)="leave()" />
        </div>

        <h2 class="world-settings-heading">
          {{ 'ui.members.heading' | transloco }}
        </h2>
        <p class="world-settings-subhead">
          {{ 'ui.members.subhead' | transloco }}
        </p>
        <div appPanel>
          <app-member-set [id]="id" />
        </div>

        <h2 class="world-settings-heading">
          {{ 'worldTypes.heading' | transloco }}
        </h2>
        <p class="world-settings-subhead">
          {{ 'worldTypes.subhead' | transloco }}
        </p>
        <div appPanel>
          <app-world-types [id]="id" />
        </div>

        <h2 class="world-settings-heading">
          {{ 'ui.publicLink.worldHeading' | transloco }}
        </h2>
        <p class="world-settings-subhead">
          {{ 'ui.publicLink.worldSubhead' | transloco }}
        </p>
        <div appPanel>
          <app-public-link kind="world" [id]="id" />
        </div>
      </section>
    }
  `,
  styles: `
    @reference '#app-styles.css';
    .world-settings {
      @apply mx-auto flex w-full max-w-2xl flex-col gap-3 p-6;
    }
    .world-settings-heading {
      @apply font-display text-2xl text-ink-strong;
    }
    .world-settings-subhead {
      @apply text-sm text-ink-muted;
    }
  `,
})
export class WorldSettings {
  private readonly router = inject(Router);
  readonly worldId = inject(ActiveWorld).worldId;

  leave(): void {
    this.router.navigate(['/']);
  }
}
