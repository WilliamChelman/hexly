import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthStore } from '../auth/auth.store';
import { ThemeService } from '../core/theme.service';
import { Button } from '../ui/button';
import { Cartouche } from '../ui/cartouche';
import { Chip } from '../ui/chip';
import { Eyebrow } from '../ui/eyebrow';
import { LogoIcon } from '../ui/icon/glyphs/logo';
import { MoonIcon } from '../ui/icon/glyphs/moon';
import { ShareIcon } from '../ui/icon/glyphs/share';
import { SunIcon } from '../ui/icon/glyphs/sun';

/** The top chrome: brand, map title, and the global actions (theme, share). */
@Component({
  selector: 'app-editor-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    Button,
    Cartouche,
    Chip,
    Eyebrow,
    LogoIcon,
    MoonIcon,
    ShareIcon,
    SunIcon,
  ],
  template: `
    <div class="brand">
      <span class="mark"><app-icon-logo [size]="26" /></span>
      <span class="name" appCartouche>Hexly</span>
    </div>

    <div class="titlebar">
      <span appEyebrow>Hex map</span>
      <span class="title">The Reach of Aldermoor</span>
      <app-chip tone="sea">Editing</app-chip>
    </div>

    <div class="actions">
      <a appButton variant="ghost" size="sm" routerLink="/styleguide">Design system</a>
      <button
        type="button"
        appButton
        variant="ghost"
        icon
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
      <button type="button" appButton variant="primary" size="sm">
        <app-icon-share [size]="16" />
        Share
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
      background: var(--surface);
      border-bottom: 1px solid var(--line-strong);
      box-shadow: var(--shadow-1);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: var(--space-2);
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
    .titlebar {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding-left: var(--space-5);
      border-left: 1px solid var(--line);
    }
    .title {
      font-family: var(--font-display);
      font-size: var(--text-md);
      color: var(--ink);
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
export class EditorHeader {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  protected readonly themeService = inject(ThemeService);
  protected readonly theme = this.themeService.theme;

  /** The signed-in user, shown in the header; `null` until authenticated. */
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
    this.auth.logout().subscribe(() => this.router.navigateByUrl('/login'));
  }
}
