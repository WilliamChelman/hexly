import {
  ChangeDetectionStrategy,
  Component,
  inject,
} from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { ActiveWorld } from '../../core/services/active-world';
import { Eyebrow } from '../../ui/eyebrow';
import { Panel } from '../../ui/panel';
import { OwnerSet } from '../../ui/owner-set';

/**
 * The World settings page (#158): bare by design — just the World's symmetric
 * owner set (view, add, remove, resign). The active World id comes from
 * {@link ActiveWorld}, pinned by the `w/:worldId` resolver (ADR-0028). Resigning
 * can cost the user reach to this World, so it drops back to the World Index.
 */
@Component({
  selector: 'app-world-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, Eyebrow, Panel, OwnerSet],
  template: `
    @if (worldId(); as id) {
      <section class="world-settings">
        <span appEyebrow>{{ 'owners.heading' | transloco }}</span>
        <h1 class="world-settings-heading">{{ 'owners.heading' | transloco }}</h1>
        <p class="world-settings-subhead">
          {{ 'owners.subhead' | transloco: { kind: 'owners.world' | transloco } }}
        </p>
        <div appPanel>
          <app-owner-set kind="world" [id]="id" (resigned)="leave()" />
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
