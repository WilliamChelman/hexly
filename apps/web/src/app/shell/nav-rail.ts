import { NgTemplateOutlet } from '@angular/common';
import { A11yModule } from '@angular/cdk/a11y';
import { BreakpointObserver } from '@angular/cdk/layout';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthStore } from '../auth/auth.store';
import { persistedPreference } from '../core/persisted-preference';
import { Button } from '../ui/button';
import { Cartouche } from '../ui/cartouche';
import { Icon, IconName } from '../ui/icon/icon';
import { UserMenu } from './user-menu';

/** A primary navigation destination: its route, glyph, and translated label. */
interface NavEntry {
  readonly link: string;
  readonly testid: string;
  readonly icon: IconName;
  /** Translation key for the visible label / accessible name (ADR-0014). */
  readonly labelKey: string;
}

const ENTRIES: readonly NavEntry[] = [
  { link: '/entities', testid: 'nav-entities', icon: 'library', labelKey: 'nav.library' },
  { link: '/styleguide', testid: 'nav-styleguide', icon: 'palette', labelKey: 'nav.styleguide' },
];

/**
 * The persistent global nav rail — the app shell's only chrome (ADR-0022,
 * supersedes ADR-0015). A slim icon strip at every viewport that owns everything
 * app-level: brand, primary navigation, and — behind the avatar ({@link UserMenu})
 * — appearance and account.
 *
 * It expands to reveal labels, viewport-driven: on wide screens it pushes the
 * page aside (a docked column that grows) and the choice is persisted; on narrow
 * screens it overlays the page transiently (focus-trapped, dismissed on
 * click-away / Escape / after a destination is chosen) so the rail never
 * permanently eats limited width.
 *
 * An anonymous viewer (no session) gets a reduced rail — brand + avatar, no
 * navigation rows — since the destinations are doors they can't open.
 *
 * ponytail: appearance/account stay in {@link UserMenu}'s popover at both widths
 * rather than morphing into an inline expanded section — the single-home
 * guarantee (ADR-0014) holds either way. Build the inline section if expanded-rail
 * affordances grow.
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
    TranslocoPipe,
  ],
  template: `
    <!--
      Docked column: in flow, so growing its width pushes the page. Hidden while
      the narrow overlay is open, so the rail body isn't instantiated twice
      (duplicate brand/nav/toggle in the a11y tree, ambiguous locators).
    -->
    @if (!overlay()) {
      <aside
        class="flex flex-col shrink-0 h-full p-2 gap-1 bg-bg-deep text-ink border-r border-line shadow-2 transition-[width] duration-200"
        data-testid="nav-rail"
        [class.w-56]="docked()"
        [class.w-12]="!docked()"
      >
        <ng-container *ngTemplateOutlet="body; context: { expanded: docked() }" />
      </aside>
    }

    <!-- Narrow: the expanded rail overlays the page and is dismissed on click-away. -->
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
        <span
          class="grid place-items-center text-gold [filter:drop-shadow(0_0_6px_var(--color-glow))]"
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
        <nav class="flex flex-col gap-1 mt-1" [attr.aria-label]="'nav.primary' | transloco">
          @for (entry of entries; track entry.link) {
            <a
              [routerLink]="entry.link"
              [attr.data-testid]="entry.testid"
              routerLinkActive="text-gold bg-gold-soft"
              ariaCurrentWhenActive="page"
              class="flex items-center gap-3 px-2 py-2 rounded-sm no-underline text-ink hover:bg-gold-soft"
              [class.justify-center]="!expanded"
              (click)="choose()"
            >
              <app-icon [name]="entry.icon" [size]="20" />
              <span [class.sr-only]="!expanded">{{ entry.labelKey | transloco }}</span>
            </a>
          }
        </nav>
      }

      <div class="flex-1"></div>

      <!--
        Account + collapse control sit together at the foot of the rail: stacked
        when collapsed, side-by-side (avatar left, chevron right) when expanded.
        The chevron points the way it moves — » to open, « to close.
      -->
      <div
        class="flex items-center gap-1"
        [class.flex-col]="!expanded"
      >
        <app-user-menu />
        <button
          type="button"
          appButton
          variant="ghost"
          icon
          data-testid="rail-toggle"
          [class.ml-auto]="expanded"
          [attr.aria-expanded]="expanded"
          [attr.aria-label]="(expanded ? 'nav.collapse' : 'nav.expand') | transloco"
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
  private readonly auth = inject(AuthStore);

  protected readonly isAuthenticated = this.auth.isAuthenticated;
  protected readonly entries = ENTRIES;

  /** Wide-viewport expand state, remembered across sessions (ADR-0022). */
  private readonly pin = persistedPreference<'collapsed' | 'expanded'>({
    storageKey: 'hexly-rail',
    values: ['collapsed', 'expanded'],
    detect: () => 'collapsed',
    apply: () => {
      /* no DOM reflection — the signal drives the layout directly */
    },
  });

  /** True above the width threshold: the rail pushes; below it, it overlays. */
  protected readonly wide = signal(true);
  /** Transient open state for the narrow overlay (never persisted). */
  protected readonly overlayOpen = signal(false);

  /** The rail's logical expanded state — persisted when wide, transient when narrow. */
  protected readonly expanded = computed(() =>
    this.wide() ? this.pin.value() === 'expanded' : this.overlayOpen(),
  );
  /** The docked column shows labels only when expanded on a wide viewport. */
  protected readonly docked = computed(() => this.wide() && this.expanded());
  /** The overlay layer renders only when expanded on a narrow viewport. */
  protected readonly overlay = computed(() => !this.wide() && this.overlayOpen());

  constructor() {
    // BreakpointObserver over a hand-rolled matchMedia listener: it cleans up via
    // takeUntilDestroyed (the rail is destroyed/recreated across login), so no
    // leaked listener fires on a dead instance.
    inject(BreakpointObserver)
      .observe('(min-width: 768px)')
      .pipe(takeUntilDestroyed())
      .subscribe(({ matches }) => {
        this.wide.set(matches);
        // Crossing to wide closes any narrow overlay, so it can't resurrect itself
        // (overlay = !wide && overlayOpen) the next time the viewport goes narrow.
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

  /** Choosing a destination on the narrow overlay collapses it (ADR-0022). */
  protected choose(): void {
    if (!this.wide()) this.overlayOpen.set(false);
  }
}
