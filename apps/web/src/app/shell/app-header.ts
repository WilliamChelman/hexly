import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { AuthStore } from '../auth/auth.store';
import { ThemeService } from '../core/theme.service';
import { Button } from '../ui/button';
import { Cartouche } from '../ui/cartouche';
import { Eyebrow } from '../ui/eyebrow';
import { LogoIcon } from '../ui/icon/glyphs/logo';
import { MoonIcon } from '../ui/icon/glyphs/moon';
import { SunIcon } from '../ui/icon/glyphs/sun';
import { HeaderService } from './header.service';

/**
 * The single, always-present application header (ADR-0015). It owns the global
 * chrome every page shares — brand, theme toggle, and the signed-in user's
 * identity + Sign out.
 */
@Component({
  selector: 'app-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'banner' },
  imports: [
    RouterLink,
    RouterOutlet,
    Button,
    Cartouche,
    Eyebrow,
    LogoIcon,
    MoonIcon,
    SunIcon,
  ],
  template: `
    <a class="brand" routerLink="/">
      <span class="mark"><app-icon-logo [size]="26" /></span>
      <span class="name" appCartouche>Hexly</span>
    </a>

    <!--
      The hybrid content region (ADR-0015): a page contributes simple declarative
      text through HeaderService, or a route projects a rich interactive component
      through the named header outlet. Both render here, between brand and actions.
    -->
    @if (eyebrow() || title()) {
      <div class="headline" data-testid="header-headline">
        @if (eyebrow(); as e) {
          <span appEyebrow>{{ e }}</span>
        }
        @if (title(); as t) {
          <span class="title">{{ t }}</span>
        }
      </div>
    }
    <router-outlet name="header" />

    <div class="actions">
      <!-- The language switcher lands here in the next slice (ADR-0014). -->
      <button
        type="button"
        appButton
        variant="ghost"
        icon
        data-testid="theme-toggle"
        (click)="themeService.toggle()"
        [attr.aria-label]="
          theme() === 'dark' ? 'Switch to parchment theme' : 'Switch to astral theme'
        "
        [title]="theme() === 'dark' ? 'Parchment (light)' : 'Astral (dark)'"
      >
        @if (theme() === 'dark') {
          <app-icon-sun [size]="20" />
        } @else {
          <app-icon-moon [size]="20" />
        }
      </button>
      @if (user(); as u) {
        <span class="avatar" [title]="u.displayName">{{ initials() }}</span>
        <span class="who">{{ u.displayName }}</span>
        <button
          type="button"
          appButton
          variant="ghost"
          size="sm"
          data-testid="sign-out"
          (click)="signOut()"
        >
          Sign out
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: var(--space-5);
      padding: 0 var(--space-4);
      height: var(--rail-header);
      background: var(--surface);
      border-bottom: 1px solid var(--line-strong);
      box-shadow: var(--shadow-1);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      text-decoration: none;
      color: inherit;
    }
    .mark {
      display: grid;
      place-items: center;
      color: var(--gold);
    }
    .name {
      font-size: var(--text-lg);
      color: var(--ink-strong);
    }
    .headline {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding-left: var(--space-5);
      border-left: 1px solid var(--line);
    }
    .title {
      font-family: var(--font-display);
      font-size: var(--text-md);
      color: var(--ink-strong);
    }
    .actions {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      margin-left: auto;
    }
    .avatar {
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      font-family: var(--font-mono);
      font-size: var(--text-2xs);
      color: var(--on-gold);
      background: linear-gradient(140deg, var(--gold), var(--gold-strong));
      border-radius: var(--radius-full);
      box-shadow: var(--shadow-1);
    }
    .who {
      font-size: var(--text-sm);
      color: var(--ink);
    }
  `,
})
export class AppHeader {
  private readonly auth = inject(AuthStore);
  private readonly header = inject(HeaderService);
  protected readonly themeService = inject(ThemeService);
  protected readonly theme = this.themeService.theme;

  /** Declarative content the active page contributed through {@link HeaderService}. */
  protected readonly eyebrow = this.header.eyebrow;
  protected readonly title = this.header.title;

  /** The signed-in user, shown whenever authenticated; `null` otherwise. */
  protected readonly user = this.auth.currentUser;

  /** The user's initials for the avatar (e.g. "Ada Lovelace" → "AL"). */
  protected readonly initials = computed(() => {
    const name = this.user()?.displayName ?? '';
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
  });

  /** End the session and return to the login screen (ADR-0004). */
  protected signOut(): void {
    this.auth.signOut();
  }
}
