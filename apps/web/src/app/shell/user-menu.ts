import {
  CdkMenu,
  CdkMenuGroup,
  CdkMenuItem,
  CdkMenuItemRadio,
  CdkMenuTrigger,
} from '@angular/cdk/menu';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthStore } from '../auth/auth.store';
import { Locale, LocaleService } from '../core/i18n/locale.service';
import { ThemeService } from '../core/theme.service';
import { Button } from '../ui/button';
import { Icon } from '../ui/icon/icon';
import { Rule } from '../ui/rule';

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
    CdkMenuTrigger,
    CdkMenu,
    CdkMenuItem,
    CdkMenuItemRadio,
    CdkMenuGroup,
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
      icon
      [cdkMenuTriggerFor]="menu"
      [attr.aria-label]="'common.userMenu' | transloco"
    >
      @if (user(); as u) {
        <span
          class="grid place-items-center size-6 font-mono text-2xs text-on-gilded bg-linear-[140deg] from-gold-bright to-gold-deep rounded-full shadow-[0_0_14px_-2px_var(--color-glow)]"
          [title]="u.displayName"
          >{{ initials() }}</span
        >
      } @else {
        <app-icon name="user" [size]="20" />
      }
    </button>

    <ng-template #menu>
      <div
        cdkMenu
        class="flex flex-col min-w-44 p-1 bg-surface-raised border border-line rounded-md shadow-2"
      >
        @if (user(); as u) {
          <span class="px-3 py-2 text-sm text-ink-strong">{{
            u.displayName
          }}</span>
          <hr appRule class="mx-1 my-1" />
        }
        <button
          type="button"
          cdkMenuItem
          class="flex items-center gap-2 px-3 py-2 text-sm text-ink text-left bg-transparent border-0 rounded-sm cursor-pointer hover:bg-gold-soft"
          [attr.aria-label]="
            (theme() === 'dark'
              ? 'common.theme.toSolar'
              : 'common.theme.toAstral'
            ) | transloco
          "
          (cdkMenuItemTriggered)="themeService.toggle()"
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
        <div cdkMenuGroup [attr.aria-label]="'common.language' | transloco">
          @for (locale of locales; track locale) {
            <button
              type="button"
              cdkMenuItemRadio
              [cdkMenuItemChecked]="locale === currentLocale()"
              class="flex items-center justify-between gap-2 w-full px-3 py-2 text-sm text-ink text-left bg-transparent border-0 rounded-sm cursor-pointer hover:bg-gold-soft"
              (cdkMenuItemTriggered)="selectLocale(locale)"
            >
              <span>{{ localeNames[locale] }}</span>
              @if (locale === currentLocale()) {
                <span class="text-gold" aria-hidden="true">✓</span>
              }
            </button>
          }
        </div>
        <hr appRule class="mx-1 my-1" />
        @if (user()) {
          <button
            type="button"
            cdkMenuItem
            class="flex items-center gap-2 px-3 py-2 text-sm text-ink text-left bg-transparent border-0 rounded-sm cursor-pointer hover:bg-gold-soft"
            (cdkMenuItemTriggered)="signOut()"
          >
            {{ 'common.signOut' | transloco }}
          </button>
        } @else {
          <a
            cdkMenuItem
            routerLink="/login"
            class="flex items-center gap-2 px-3 py-2 text-sm text-ink no-underline rounded-sm cursor-pointer hover:bg-gold-soft"
          >
            {{ 'common.login' | transloco }}
          </a>
        }
      </div>
    </ng-template>
  `,
})
export class UserMenu {
  private readonly auth = inject(AuthStore);
  private readonly locale = inject(LocaleService);
  protected readonly themeService = inject(ThemeService);
  protected readonly theme = this.themeService.theme;

  /** The signed-in user, or `null` when anonymous. */
  protected readonly user = this.auth.currentUser;

  /** The languages offered, sourced from {@link LocaleService}, and the active one. */
  protected readonly locales = this.locale.locales;
  protected readonly currentLocale = this.locale.lang;
  protected readonly localeNames: Record<Locale, string> = {
    en: 'English',
    fr: 'Français',
  };

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
