import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { WorldStore } from '../core/services/world.store';
import { ActiveWorld } from '../core/services/active-world';
import { Icon } from '../ui/icon/icon';
import { Rule } from '../ui/rule';

/**
 * The World Switcher (ADR-0028): a compact quick-hop dropdown docked by the user
 * menu in the nav-rail foot, at both rail widths. It is pure navigation — the
 * trigger shows the current World (its name expanded, an initial chip collapsed),
 * the menu lists every reachable World and switches by URL (the active World is a
 * URL fact, {@link ActiveWorld}), and offers a path to the World Index. It does
 * not manage Worlds — create/rename/delete live on the Index (#121).
 */
@Component({
  selector: 'app-world-switcher',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CdkMenuTrigger,
    CdkMenu,
    CdkMenuItem,
    RouterLink,
    Icon,
    Rule,
    TranslocoPipe,
  ],
  template: `
    <button
      type="button"
      data-testid="switcher"
      class="flex items-center gap-2 w-full px-2 py-1 rounded-sm bg-surface-sunken border border-line text-ink-strong text-sm text-left cursor-pointer hover:bg-gold-soft focus:border-gold outline-none"
      [class.justify-center]="!expanded()"
      [class.px-0]="!expanded()"
      [title]="activeName() ?? ('worlds.switcher' | transloco)"
      [attr.aria-label]="'worlds.switcherLabel' | transloco"
      [cdkMenuTriggerFor]="menu"
    >
      <span
        data-testid="switcher-initial"
        class="grid place-items-center shrink-0 size-6 font-mono text-2xs text-on-gilded bg-linear-[140deg] from-gold-bright to-gold-deep rounded-full"
        aria-hidden="true"
        >{{ initial() }}</span
      >
      <span class="flex-1 truncate" [class.sr-only]="!expanded()">{{
        activeName() ?? ('worlds.switcher' | transloco)
      }}</span>
      @if (expanded()) {
        <app-icon name="chevrons" [size]="14" class="shrink-0 opacity-60" />
      }
    </button>

    <ng-template #menu>
      <div
        cdkMenu
        class="flex flex-col min-w-44 p-1 bg-surface-raised border border-line rounded-md shadow-2"
      >
        @for (world of worlds(); track world.id) {
          <button
            type="button"
            cdkMenuItem
            [attr.data-testid]="'switcher-option-' + world.id"
            class="flex items-center justify-between gap-2 px-3 py-2 text-sm text-ink text-left bg-transparent border-0 rounded-sm cursor-pointer hover:bg-gold-soft"
            (cdkMenuItemTriggered)="switch(world.id)"
          >
            <span class="truncate">{{ world.name }}</span>
            @if (world.id === activeId()) {
              <span class="text-gold" aria-hidden="true">✓</span>
            }
          </button>
        }
        <hr appRule class="mx-1 my-1" />
        <a
          cdkMenuItem
          routerLink="/"
          data-testid="switcher-index-link"
          class="flex items-center gap-2 px-3 py-2 text-sm text-ink no-underline rounded-sm cursor-pointer hover:bg-gold-soft"
        >
          <app-icon name="library" [size]="18" />
          {{ 'worlds.allWorlds' | transloco }}
        </a>
      </div>
    </ng-template>
  `,
})
export class WorldSwitcher {
  private readonly store = inject(WorldStore);
  private readonly activeWorld = inject(ActiveWorld);
  private readonly router = inject(Router);

  /** Whether the rail is expanded — drives the full-name vs initial-chip trigger. */
  readonly expanded = input(false);

  protected readonly worlds = this.store.worlds;
  protected readonly activeId = this.activeWorld.worldId;

  /** The active World's name, or `null` outside a World (the Index). */
  protected readonly activeName = computed(
    () => this.worlds().find((w) => w.id === this.activeId())?.name ?? null,
  );
  /** The active World's first letter for the collapsed chip; '?' when none. */
  protected readonly initial = computed(
    () => this.activeName()?.trim()[0]?.toUpperCase() ?? '?',
  );

  constructor() {
    this.store.load();
  }

  protected switch(id: string): void {
    this.router.navigate(['/w', id, 'entities']);
  }
}
