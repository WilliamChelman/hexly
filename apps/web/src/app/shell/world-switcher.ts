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
 * The World Switcher (ADR-0028): a compact quick-hop dropdown that sits at the
 * nav-rail masthead (under the brand), at both rail widths. It is pure navigation
 * — the trigger shows the current World as a square gilt crest tile (its name
 * beside the tile when expanded, the tile alone when collapsed),
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
      class="group flex items-center gap-2 w-full rounded-md text-left cursor-pointer outline-none transition-colors"
      [class]="
        expanded()
          ? 'px-2 py-2 bg-surface-sunken border border-line hover:border-gold focus:border-gold'
          : 'justify-center p-0 bg-transparent border-0'
      "
      [title]="activeName() ?? ('worlds.switcher' | transloco)"
      [attr.aria-label]="'worlds.switcherLabel' | transloco"
      [cdkMenuTriggerFor]="menu"
    >
      <!-- A square gilt tile with a gold ring marks the active World. Its shape
           (against the round personal avatar in the rail foot) is what keeps the
           crest from reading as a second copy of the user menu. -->
      <span
        data-testid="switcher-initial"
        class="grid place-items-center shrink-0 rounded-md font-mono text-2xs text-gold bg-surface-sunken border border-gold ring-2 ring-gold/30 [box-shadow:0_0_10px_-2px_var(--color-glow)] transition-colors"
        [class]="
          expanded()
            ? 'size-7'
            : 'size-6 group-hover:bg-gold-soft group-hover:ring-gold/60'
        "
        aria-hidden="true"
        >{{ initial() }}</span
      >
      @if (expanded()) {
        <span class="flex flex-col min-w-0 flex-1 leading-tight">
          <span class="text-2xs uppercase tracking-wide text-ink-faint">{{
            'worlds.crestLabel' | transloco
          }}</span>
          <span class="text-sm text-ink-strong truncate">{{
            activeName() ?? ('worlds.switcher' | transloco)
          }}</span>
        </span>
        <app-icon name="chevrons" [size]="13" class="shrink-0 opacity-60" />
      } @else {
        <!-- Keep the World name in the DOM for assistive tech (and so the trigger
             is addressable by name) even when the rail hides it visually. -->
        <span class="sr-only">{{
          activeName() ?? ('worlds.switcher' | transloco)
        }}</span>
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
