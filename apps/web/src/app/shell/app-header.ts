import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { Cartouche } from '../ui/cartouche';
import { Eyebrow } from '../ui/eyebrow';
import { Icon } from '../ui/icon/icon';
import { HeaderService } from './header.service';
import { UserMenu } from './user-menu';

/**
 * The single, always-present application header (ADR-0015). It owns the global
 * chrome every page shares — the brand, a page's declarative headline, and the
 * {@link UserMenu} (theme, language, and the session action).
 */
@Component({
  selector: 'app-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'banner',
    class:
      'flex items-center gap-4 px-4 h-[var(--rail-header)] bg-linear-[180deg] from-surface to-bg-deep border-b border-b-line shadow-2',
  },
  imports: [RouterLink, RouterOutlet, Cartouche, Eyebrow, Icon, UserMenu],
  template: `
    <a class="brand flex items-center gap-2 no-underline text-inherit" routerLink="/">
      <span
        class="grid place-items-center text-gold [filter:drop-shadow(0_0_6px_var(--color-glow))]"
        ><app-icon name="logo" [size]="26"
      /></span>
      <span
        class="text-[27px] leading-none tracking-[0.01em]! normal-case! bg-linear-[180deg] from-gold-bright to-gold-deep bg-clip-text text-transparent [filter:drop-shadow(0_0_8px_var(--color-glow))]"
        appCartouche
        >Hexly</span
      >
    </a>

    <!--
      The hybrid content region (ADR-0015): a page contributes simple declarative
      text through HeaderService, or a route projects a rich interactive component
      through the named header outlet. Both render here, between brand and actions.
    -->
    @if (content(); as c) {
      <div class="flex items-center gap-3 shrink-0" data-testid="header-headline">
        <span class="w-px h-[26px] bg-line-strong shrink-0"></span>
        @if (c.eyebrow; as e) {
          <span appEyebrow class="text-gold! tracking-[0.28em] whitespace-nowrap">{{
            e
          }}</span>
        }
        @if (c.title; as t) {
          <span class="font-display text-[22px] text-ink-strong whitespace-nowrap">{{
            t
          }}</span>
        }
      </div>
    }
    <router-outlet name="header" />

    <app-user-menu class="ml-auto" />
  `,
})
export class AppHeader {
  private readonly header = inject(HeaderService);

  /** Declarative content the active page contributed through {@link HeaderService}. */
  protected readonly content = this.header.content;
}
