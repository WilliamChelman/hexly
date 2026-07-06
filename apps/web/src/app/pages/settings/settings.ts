import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { MIN_PASSWORD_LENGTH } from '@hexly/domain';
import {
  FormatLocale,
  Locale,
  LocaleService,
} from '../../core/i18n/locale.service';
import { AuthClient } from '../../core/services/auth.client';
import { ThemeService, Theme } from '../../core/services/theme.service';
import { ToasterService } from '../../core/services/toaster.service';
import { Eyebrow } from '../../ui/eyebrow';
import { Field } from '../../ui/field';
import { Input } from '../../ui/input';
import { Panel } from '../../ui/panel';
import { Select } from '../../ui/select';
import { Button } from '../../ui/button';

/** What went wrong with the password form, keyed into `settings.password.*`. */
type PasswordError = '' | 'tooShort' | 'wrongCurrent' | 'error';

/**
 * The User Settings page (ADR-0038): Preferences — theme, Locale, Format
 * Locale — applied and persisted instantly through the very signals the user
 * menu writes (one source of truth, two entry points; PreferencesSync pushes
 * them to the account), plus the self-service profile: display name and
 * password behind explicit forms. Email is the login identity and stays
 * read-only.
 */
@Component({
  selector: 'app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, Eyebrow, Field, Input, Panel, Select, Button],
  template: `
    <section class="settings">
      <span appEyebrow>{{ 'settings.heading' | transloco }}</span>
      <h1 class="settings-heading">{{ 'settings.heading' | transloco }}</h1>
      <p class="settings-subhead">{{ 'settings.subhead' | transloco }}</p>

      <h2 class="settings-heading text-xl">
        {{ 'settings.preferences.heading' | transloco }}
      </h2>
      <div appPanel class="settings-panel">
        <div appField [label]="'settings.preferences.theme' | transloco">
          <span class="flex gap-2" role="group">
            <button
              type="button"
              appButton
              [active]="theme() === 'light'"
              [attr.aria-pressed]="theme() === 'light'"
              data-testid="theme-light"
              (click)="setTheme('light')"
            >
              {{ 'common.theme.solar' | transloco }}
            </button>
            <button
              type="button"
              appButton
              [active]="theme() === 'dark'"
              [attr.aria-pressed]="theme() === 'dark'"
              data-testid="theme-dark"
              (click)="setTheme('dark')"
            >
              {{ 'common.theme.astral' | transloco }}
            </button>
          </span>
        </div>

        <label appField [label]="'settings.preferences.language' | transloco">
          <select
            appSelect
            data-testid="language"
            [value]="lang()"
            (change)="setLang($any($event.target).value)"
          >
            @for (l of locale.locales; track l) {
              <option [value]="l">{{ 'common.locale.' + l | transloco }}</option>
            }
          </select>
        </label>

        <label appField [label]="'settings.preferences.formatLocale' | transloco">
          <select
            appSelect
            data-testid="format-locale"
            [value]="locale.formatLocale()"
            (change)="setFormatLocale($any($event.target).value)"
          >
            @for (opt of formatOptions(); track opt.tag) {
              <option [value]="opt.tag">{{ opt.label }}</option>
            }
          </select>
          <span class="settings-hint">{{ 'settings.preferences.formatLocaleHint' | transloco }}</span>
        </label>
      </div>

      <h2 class="settings-heading text-xl">
        {{ 'settings.profile.heading' | transloco }}
      </h2>
      <div appPanel class="settings-panel">
        <div appField [label]="'settings.profile.email' | transloco">
          <span class="text-sm text-ink" data-testid="email">{{ user()?.email }}</span>
          <span class="settings-hint">{{ 'settings.profile.emailHint' | transloco }}</span>
        </div>
        <form (submit)="saveProfile($event)">
          <label appField [label]="'settings.profile.displayName' | transloco">
            <span class="flex gap-2">
              <input
                appInput
                type="text"
                class="flex-1"
                data-testid="display-name"
                [value]="displayName()"
                (input)="displayName.set($any($event.target).value)"
              />
              <button
                type="submit"
                appButton
                data-testid="save-profile"
                [disabled]="savingProfile() || !displayName().trim()"
              >
                {{ 'settings.profile.save' | transloco }}
              </button>
            </span>
          </label>
        </form>
      </div>

      <h2 class="settings-heading text-xl">
        {{ 'settings.password.heading' | transloco }}
      </h2>
      <div appPanel class="settings-panel">
        <form class="flex flex-col gap-4" (submit)="changePassword($event)">
          <label appField [label]="'settings.password.current' | transloco">
            <input
              appInput
              type="password"
              autocomplete="current-password"
              data-testid="current-password"
              [value]="currentPassword()"
              (input)="currentPassword.set($any($event.target).value)"
            />
          </label>
          <label appField [label]="'settings.password.new' | transloco">
            <input
              appInput
              type="password"
              autocomplete="new-password"
              data-testid="new-password"
              [value]="newPassword()"
              (input)="newPassword.set($any($event.target).value)"
            />
          </label>
          @if (passwordError(); as error) {
            <p class="text-sm text-danger" role="alert" data-testid="password-error">
              {{ 'settings.password.' + error | transloco }}
            </p>
          }
          <span>
            <button
              type="submit"
              appButton
              data-testid="change-password"
              [disabled]="changingPassword() || !currentPassword() || !newPassword()"
            >
              {{ 'settings.password.submit' | transloco }}
            </button>
          </span>
        </form>
      </div>
    </section>
  `,
  styles: `
    @reference '#app-styles.css';
    .settings {
      @apply mx-auto flex w-full max-w-2xl flex-col gap-3 p-6;
    }
    .settings-heading {
      @apply font-display text-2xl text-ink-strong;
    }
    .settings-subhead {
      @apply text-sm text-ink-muted;
    }
    .settings-panel {
      @apply flex flex-col gap-4 p-4;
    }
    .settings-hint {
      @apply text-2xs text-ink-muted;
    }
  `,
})
export class Settings {
  private readonly auth = inject(AuthClient);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);
  protected readonly locale = inject(LocaleService);
  private readonly themeService = inject(ThemeService);

  protected readonly user = this.auth.currentUser;
  protected readonly theme = this.themeService.theme;
  protected readonly lang = this.locale.lang;

  /**
   * The Format Locale picker options, labelled in the active UI language
   * ("English (United Kingdom) — 7/5/2026", "anglais (Royaume-Uni) — 05/07/2026")
   * with a live preview of today's date — no per-tag copy to translate. Built
   * once per language change instead of re-deriving ~28 `Intl.DisplayNames`
   * lookups and date formats on every change detection.
   */
  protected readonly formatOptions = computed(() => {
    const names = new Intl.DisplayNames([this.transloco.activeLang()], {
      type: 'language',
      languageDisplay: 'standard',
    });
    const today = new Date();
    const same = this.transloco.translate('settings.preferences.format.same');
    return this.locale.formatLocales.map((tag) => ({
      tag,
      label: tag ? `${names.of(tag) ?? tag} — ${today.toLocaleDateString(tag)}` : same,
    }));
  });

  /** Follows the account name until the user starts typing their own value. */
  protected readonly displayName = linkedSignal(
    () => this.user()?.displayName ?? '',
  );
  protected readonly savingProfile = signal(false);

  protected readonly currentPassword = signal('');
  protected readonly newPassword = signal('');
  protected readonly passwordError = signal<PasswordError>('');
  protected readonly changingPassword = signal(false);

  protected setTheme(theme: Theme): void {
    this.themeService.set(theme);
  }

  protected setLang(lang: Locale): void {
    this.locale.set(lang);
  }

  protected setFormatLocale(tag: FormatLocale): void {
    this.locale.setFormatLocale(tag);
  }

  protected saveProfile(event: Event): void {
    event.preventDefault();
    const name = this.displayName().trim();
    if (!name || this.savingProfile()) return;
    this.savingProfile.set(true);
    this.auth.updateProfile(name).subscribe({
      next: () => {
        this.savingProfile.set(false);
        this.toaster.show(this.transloco.translate('settings.profile.saved'), 'success');
      },
      error: () => {
        this.savingProfile.set(false);
        this.toaster.show(this.transloco.translate('settings.profile.saveError'), 'error');
      },
    });
  }

  protected changePassword(event: Event): void {
    event.preventDefault();
    if (this.changingPassword()) return;
    this.passwordError.set('');
    if (this.newPassword().length < MIN_PASSWORD_LENGTH) {
      this.passwordError.set('tooShort');
      return;
    }
    this.changingPassword.set(true);
    this.auth.changePassword(this.currentPassword(), this.newPassword()).subscribe({
      next: () => {
        this.changingPassword.set(false);
        this.currentPassword.set('');
        this.newPassword.set('');
        this.toaster.show(this.transloco.translate('settings.password.changed'), 'success');
      },
      error: (err: unknown) => {
        this.changingPassword.set(false);
        this.passwordError.set(
          err instanceof Object && 'status' in err && err.status === 401
            ? 'wrongCurrent'
            : 'error',
        );
      },
    });
  }
}
