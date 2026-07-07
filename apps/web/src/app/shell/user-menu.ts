import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthClient } from '../core/services/auth.client';
import { Locale, LocaleService } from '../core/i18n/locale.service';
import { ThemeService } from '../core/services/theme.service';
import { Button } from '../ui/button';
import { Icon } from '../ui/icon/icon';
import { Rule } from '../ui/rule';
import {
  MenuGroup,
  MenuItem,
  MenuItemRadio,
  MenuPanel,
  MenuTrigger,
} from '../ui/menu';

/**
 * The header's account control (ADR-0015): a single trigger that opens a CDK
 * menu gathering the global, account-independent preferences — theme and
 * language — plus the session action. The menu is offered to everyone, anonymous
 * public-link viewers included (ADR-0014); only the session row swaps, between
 * Sign out when authenticated and Login otherwise. The trigger shows the
 * signed-in user's initials, or a neutral person glyph when signed out.
 */
@Component({
  selector: 'app-user-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MenuTrigger,
    MenuPanel,
    MenuItem,
    MenuItemRadio,
    MenuGroup,
    RouterLink,
    Button,
    Icon,
    Rule,
    TranslocoPipe,
  ],
  template: `
    <button
      type="button"
      appButton
      variant="ghost"
      [icon]="!expanded()"
      [class.w-full]="expanded()"
      [class.!justify-start]="expanded()"
      [appMenuTrigger]="menu"
      [attr.aria-label]="'common.userMenu' | transloco"
    >
      @if (user(); as u) {
        <span
          class="grid place-items-center shrink-0 size-6 font-mono text-2xs text-on-gilded bg-linear-[140deg] from-gold-bright to-gold-deep rounded-full shadow-[0_0_14px_-2px_var(--color-glow)]"
          [title]="u.displayName"
          >{{ initials() }}</span
        >
        @if (expanded()) {
          <span class="text-sm text-ink truncate">{{ u.displayName }}</span>
        }
      } @else {
        <app-icon name="user" [size]="20" />
        @if (expanded()) {
          <span class="text-sm text-ink truncate">{{
            'common.userMenu' | transloco
          }}</span>
        }
      }
    </button>

    <ng-template #menu>
      <div appMenuPanel>
        @if (user(); as u) {
          <span class="px-3 py-2 text-sm text-ink-strong">{{
            u.displayName
          }}</span>
          <hr appRule class="mx-1 my-1" />
        }
        <button
          type="button"
          appMenuItem
          [attr.aria-label]="
            (theme() === 'dark'
              ? 'common.theme.toSolar'
              : 'common.theme.toAstral'
            ) | transloco
          "
          (triggered)="themeService.toggle()"
        >
          @if (theme() === 'dark') {
            <app-icon name="sun" [size]="18" />
            <span>{{ 'common.theme.solar' | transloco }}</span>
          } @else {
            <app-icon name="moon" [size]="18" />
            <span>{{ 'common.theme.astral' | transloco }}</span>
          }
        </button>
        <hr appRule class="mx-1 my-1" />
        <div appMenuGroup [attr.aria-label]="'common.language' | transloco">
          @for (locale of locales; track locale) {
            <button
              type="button"
              appMenuItemRadio
              [checked]="locale === currentLocale()"
              (triggered)="selectLocale(locale)"
            >
              <span>{{ 'common.locale.' + locale | transloco }}</span>
            </button>
          }
        </div>
        <hr appRule class="mx-1 my-1" />
        @if (user()) {
          <a appMenuItem routerLink="/settings">
            {{ 'common.settings' | transloco }}
          </a>
          <button type="button" appMenuItem (triggered)="signOut()">
            {{ 'common.signOut' | transloco }}
          </button>
        } @else {
          <a appMenuItem routerLink="/login">
            {{ 'common.login' | transloco }}
          </a>
        }
      </div>
    </ng-template>
  `,
})
export class UserMenu {
  /** Whether the nav rail is expanded — drives the full-name vs avatar-only trigger. */
  readonly expanded = input(false);

  private readonly auth = inject(AuthClient);
  private readonly locale = inject(LocaleService);
  protected readonly themeService = inject(ThemeService);
  protected readonly theme = this.themeService.theme;

  /** The signed-in user, or `null` when anonymous. */
  protected readonly user = this.auth.currentUser;

  /** The languages offered, sourced from {@link LocaleService}, and the active one. */
  protected readonly locales = this.locale.locales;
  protected readonly currentLocale = this.locale.lang;

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

  protected selectLocale(locale: Locale): void {
    this.locale.set(locale);
  }

  /** End the session and return to the login screen (ADR-0004). */
  protected signOut(): void {
    this.auth.signOut();
  }
}
