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
import { AuthClient, WorldStore, ActiveWorld, AuthScopedStorage, AppShellStore } from '@hexly/web-core';
import { Button, Cartouche, Icon } from '@hexly/web-ui';
import { UserMenu } from './user-menu';
import { WorldSwitcher } from './world-switcher';
import { NavEntry, NavRailStore } from './nav-rail.store';

const STATIC_ENTRIES: readonly NavEntry[] = [
  {
    link: '/',
    testid: 'nav-worlds',
    icon: 'globe',
    labelKey: 'nav.worlds',
    exact: true,
  },
  {
    link: '/styleguide',
    testid: 'nav-styleguide',
    icon: 'palette',
    labelKey: 'nav.styleguide',
  },
];

/**
 * The persistent global nav rail. Expands to reveal labels on wide viewports
 * (docked, persisted); overlays transiently on narrow viewports (focus-trapped,
 * dismissed on click-away / Escape / destination chosen).
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
        <!-- The Switcher is World-scoped: on the Index, the Index itself is the chooser. -->
        @if (activeWorldId()) {
          <app-world-switcher [expanded]="expanded" />
        }

        <nav
          class="flex flex-col gap-1 mt-1"
          [attr.aria-label]="'nav.primary' | transloco"
        >
          @for (entry of entries(); track entry.testid) {
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

      <div class="flex items-center gap-1" [class.flex-col]="!expanded">
        <app-user-menu [expanded]="expanded" [class.flex-1]="expanded" />
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
  private readonly rail = inject(NavRailStore);

  protected readonly isAuthenticated = this.auth.isAuthenticated;
  protected readonly loading = inject(AppShellStore).loading;
  protected readonly activeWorldId = this.activeWorld.worldId;
  // The rail renders destinations, it doesn't build them: inside a World the
  // World layout fills the slot; elsewhere the rail's own instance-scoped links show.
  protected readonly entries = computed<readonly NavEntry[]>(() => {
    const injected = this.rail.entries();
    if (injected.length) return injected;
    // In a World before its layout fills the slot: show nothing rather than
    // flash the instance nav for a frame.
    if (this.activeWorldId()) return [];
    return [
      ...STATIC_ENTRIES,
      // Admin/Superadmin only — the same gate the route enforces server-side.
      ...(this.auth.canAdminister()
        ? [{ link: '/admin', testid: 'nav-admin', icon: 'user' as const, labelKey: 'nav.admin' }]
        : []),
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
    // The rail is the always-present authenticated chrome, so it owns loading
    // the World list — the active World must be known even while collapsed.
    effect(() => {
      if (this.isAuthenticated()) this.worlds.load();
    });

    // takeUntilDestroyed: the rail is destroyed/recreated across login.
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
