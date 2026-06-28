import { NgTemplateOutlet } from '@angular/common';
import { A11yModule } from '@angular/cdk/a11y';
import { BreakpointObserver } from '@angular/cdk/layout';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthClient } from '../core/services/auth.client';
import { WorldStore } from '../core/services/world.store';
import { ActiveWorld } from '../core/services/active-world';
import { AppShellStore } from './app-shell.store';
import { AuthScopedStorage } from '../core/services/auth-scoped-storage';
import { Button } from '../ui/button';
import { Cartouche } from '../ui/cartouche';
import { Icon, IconName } from '../ui/icon/icon';
import { UserMenu } from './user-menu';
import { WorldSwitcher } from './world-switcher';

interface NavEntry {
  readonly link: string;
  readonly testid: string;
  readonly icon: IconName;
  readonly labelKey: string;
  readonly exact?: boolean;
}

// Static entries below the (world-scoped) Library link, which is computed per URL.
const STATIC_ENTRIES: readonly NavEntry[] = [
  {
    link: '/styleguide',
    testid: 'nav-styleguide',
    icon: 'palette',
    labelKey: 'nav.styleguide',
  },
];

/**
 * The persistent global nav rail (ADR-0022). Expands to reveal labels on wide
 * viewports (docked, persisted); overlays transiently on narrow viewports
 * (focus-trapped, dismissed on click-away / Escape / destination chosen).
 *
 * ponytail: appearance/account stay in {@link UserMenu}'s popover at both widths.
 * Build the inline section if expanded-rail affordances grow.
 */
@Component({
  selector: 'app-nav-rail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents', '(keydown.escape)': 'overlayOpen.set(false)' },
  imports: [
    NgTemplateOutlet,
    A11yModule,
    RouterLink,
    RouterLinkActive,
    Button,
    Cartouche,
    Icon,
    UserMenu,
    WorldSwitcher,
    TranslocoPipe,
  ],
  template: `
    <!--
      Docked column: in flow, so growing its width pushes the page. Hidden while
      the narrow overlay is open to avoid duplicate content in the a11y tree.
    -->
    @if (!overlay()) {
      <aside
        class="flex flex-col shrink-0 h-full p-2 gap-1 bg-bg-deep text-ink border-r border-line shadow-2 transition-[width] duration-200"
        data-testid="nav-rail"
        [class.w-56]="docked()"
        [class.w-12]="!docked()"
      >
        <ng-container
          *ngTemplateOutlet="body; context: { expanded: docked() }"
        />
      </aside>
    }

    <!-- Narrow: expanded rail overlays the page, dismissed on click-away. -->
    @if (overlay()) {
      <button
        type="button"
        class="fixed inset-0 z-40 bg-bg-deep/60 border-0 cursor-default"
        data-testid="rail-backdrop"
        [attr.aria-label]="'nav.collapse' | transloco"
        (click)="overlayOpen.set(false)"
      ></button>
      <aside
        class="fixed inset-y-0 left-0 z-50 flex flex-col w-56 h-full p-2 gap-1 bg-bg-deep text-ink border-r border-line shadow-2"
        data-testid="nav-rail-overlay"
        cdkTrapFocus
        [cdkTrapFocusAutoCapture]="true"
      >
        <ng-container *ngTemplateOutlet="body; context: { expanded: true }" />
      </aside>
    }

    <ng-template #body let-expanded="expanded">
      <a
        routerLink="/"
        data-testid="brand"
        class="flex items-center gap-2 px-1 py-2 no-underline text-inherit"
        [class.justify-center]="!expanded"
        [attr.aria-label]="'nav.home' | transloco"
        (click)="choose()"
      >
        <!-- The brand mark doubles as the subtle loading metaphor: it pulses
             while in-page work is in flight (a fetch, an entity load, a save). -->
        <span
          class="grid place-items-center text-gold [filter:drop-shadow(0_0_6px_var(--color-glow))]"
          [class.animate-pulse]="loading() === 'subtle'"
          [attr.aria-busy]="loading() === 'subtle'"
          ><app-icon name="logo" [size]="26"
        /></span>
        <span
          class="text-[22px] leading-none normal-case! bg-linear-[180deg] from-gold-bright to-gold-deep bg-clip-text text-transparent"
          [class.sr-only]="!expanded"
          appCartouche
          >Hexly</span
        >
      </a>

      @if (isAuthenticated()) {
        <!-- The World switcher needs width for its select + label, so it shows
             only on the expanded rail (ADR-0024); the collapsed rail stays icon-only. -->
        @if (expanded) {
          <div class="flex flex-col gap-1 mt-1 px-1">
            <app-world-switcher />
          </div>
        }
        <nav
          class="flex flex-col gap-1 mt-1"
          [attr.aria-label]="'nav.primary' | transloco"
        >
          @for (entry of entries(); track entry.link) {
            <a
              [routerLink]="entry.link"
              [attr.data-testid]="entry.testid"
              routerLinkActive="text-gold bg-gold-soft"
              [routerLinkActiveOptions]="{ exact: !!entry.exact }"
              ariaCurrentWhenActive="page"
              class="flex items-center gap-3 px-2 py-2 rounded-sm no-underline text-ink hover:bg-gold-soft"
              [class.justify-center]="!expanded"
              (click)="choose()"
            >
              <app-icon [name]="entry.icon" [size]="20" />
              <span [class.sr-only]="!expanded">{{
                entry.labelKey | transloco
              }}</span>
            </a>
          }
        </nav>
      }

      <div class="flex-1"></div>

      <!--
        Avatar and collapse toggle sit together at the foot: stacked when
        collapsed, side-by-side when expanded. Chevron points the way it moves.
      -->
      <div class="flex items-center gap-1" [class.flex-col]="!expanded">
        <app-user-menu />
        <button
          type="button"
          appButton
          variant="ghost"
          icon
          data-testid="rail-toggle"
          [class.ml-auto]="expanded"
          [attr.aria-expanded]="expanded"
          [attr.aria-label]="
            (expanded ? 'nav.collapse' : 'nav.expand') | transloco
          "
          (click)="toggle()"
        >
          <app-icon
            name="chevrons"
            [size]="18"
            class="transition-transform"
            [class.rotate-180]="expanded"
          />
        </button>
      </div>
    </ng-template>
  `,
})
export class NavRail {
  private readonly auth = inject(AuthClient);
  private readonly worlds = inject(WorldStore);
  private readonly activeWorld = inject(ActiveWorld);

  protected readonly isAuthenticated = this.auth.isAuthenticated;
  protected readonly loading = inject(AppShellStore).loading;
  // The Library link follows the World in the URL (ADR-0028); on the Index (no
  // World) it points back at the Index itself.
  protected readonly entries = computed<readonly NavEntry[]>(() => {
    const worldId = this.activeWorld.worldId();
    return [
      {
        link: worldId ? `/w/${worldId}/entities` : '/',
        testid: 'nav-entities',
        icon: 'library',
        labelKey: 'nav.library',
        exact: !worldId,
      },
      ...STATIC_ENTRIES,
    ];
  });

  private readonly pin = inject(AuthScopedStorage).preference<'collapsed' | 'expanded'>({
    storageKey: 'hexly-rail',
    values: ['collapsed', 'expanded'],
    detect: () => 'collapsed',
    apply: () => {
      /* no DOM reflection — the signal drives the layout directly */
    },
  });

  protected readonly wide = signal(true);
  protected readonly overlayOpen = signal(false);

  protected readonly expanded = computed(() =>
    this.wide() ? this.pin.value() === 'expanded' : this.overlayOpen(),
  );
  protected readonly docked = computed(() => this.wide() && this.expanded());
  protected readonly overlay = computed(
    () => !this.wide() && this.overlayOpen(),
  );

  constructor() {
    // The rail is the always-present authenticated chrome, so it owns loading the
    // World list (ADR-0024) — the switcher only shows on the expanded rail, but the
    // active World must be known even when collapsed so the browser can scope to it.
    effect(() => {
      if (this.isAuthenticated()) this.worlds.load();
    });

    // BreakpointObserver cleans up via takeUntilDestroyed so no listener fires
    // on a dead instance (rail is destroyed/recreated across login).
    inject(BreakpointObserver)
      .observe('(min-width: 768px)')
      .pipe(takeUntilDestroyed())
      .subscribe(({ matches }) => {
        this.wide.set(matches);
        if (matches) this.overlayOpen.set(false);
      });
  }

  protected toggle(): void {
    if (this.wide()) {
      this.pin.set(this.pin.value() === 'expanded' ? 'collapsed' : 'expanded');
    } else {
      this.overlayOpen.update((open) => !open);
    }
  }

  protected choose(): void {
    if (!this.wide()) this.overlayOpen.set(false);
  }
}
