import { HttpClient } from '@angular/common/http';
import {
  effect,
  EnvironmentProviders,
  inject,
  Injectable,
  provideEnvironmentInitializer,
  untracked,
} from '@angular/core';
import { catchError, of } from 'rxjs';
import { AuthUser, PreferencesPatch } from '@hexly/domain';
import { FormatLocale, Locale, LocaleService } from '../i18n/locale.service';
import { Theme, ThemeService } from './theme.service';
import { AuthClient } from './auth.client';

/** The three roaming prefs as concrete, client-side values ('' = unset). */
interface Snapshot {
  locale: Locale;
  formatLocale: FormatLocale;
  theme: Theme;
}

/**
 * Two-way glue between the local preference signals and the account bag
 * (ADR-0038). On `/auth/me` resolve, an explicit server field overwrites the
 * local state; an *absent* field means "no expressed choice" and the device
 * keeps whatever it already resolved. Afterwards, signal changes are PATCHed
 * fire-and-forget.
 *
 * Roaming happens at session (re)resolve — login or reload — not live: `/auth/me`
 * is read once per session, so two open sessions can differ until one reloads.
 *
 * While anonymous, nothing is sent (ADR-0014 local-only behaviour).
 */
@Injectable({ providedIn: 'root' })
export class PreferencesSync {
  private readonly http = inject(HttpClient);
  private readonly locale = inject(LocaleService);
  private readonly theme = inject(ThemeService);
  private readonly auth = inject(AuthClient);

  /**
   * The state last known to match the server, or `null` while anonymous.
   * Hydration is detected by a user-id change; a signal value differing from
   * this snapshot afterwards is a genuine user action to push.
   */
  private synced: { userId: string; prefs: Snapshot } | null = null;

  constructor() {
    effect(() => {
      const user = this.auth.currentUser();
      const current: Snapshot = {
        locale: this.locale.lang(),
        formatLocale: this.locale.formatLocale(),
        theme: this.theme.theme(),
      };
      untracked(() => this.reconcile(user, current));
    });
  }

  private reconcile(user: AuthUser | null, current: Snapshot): void {
    if (!user) {
      this.synced = null;
      return;
    }

    if (this.synced?.userId !== user.id) {
      // Session (re)resolved: hydrate. An explicit server field wins; an absent
      // one keeps the device's current value rather than a detected default.
      const target: Snapshot = {
        locale: user.preferences.locale ?? current.locale,
        formatLocale: user.preferences.formatLocale ?? current.formatLocale,
        theme: user.preferences.theme ?? current.theme,
      };
      this.synced = { userId: user.id, prefs: target };
      if (current.locale !== target.locale) this.locale.set(target.locale);
      if (current.formatLocale !== target.formatLocale) {
        this.locale.setFormatLocale(target.formatLocale);
      }
      if (current.theme !== target.theme) this.theme.set(target.theme);
      return;
    }

    // Steady state: push what the user changed since the last known-synced
    // values. '' formatLocale = "Same as language" = clear on the server.
    const prev = this.synced.prefs;
    const patch: PreferencesPatch = {
      ...(current.locale !== prev.locale && { locale: current.locale }),
      ...(current.formatLocale !== prev.formatLocale && {
        formatLocale: current.formatLocale || null,
      }),
      ...(current.theme !== prev.theme && { theme: current.theme }),
    };
    if (Object.keys(patch).length === 0) return;

    this.synced = { userId: user.id, prefs: current };
    // Fire-and-forget: a lost pref write is benign, the local state stands.
    this.http
      .patch('/api/auth/me/preferences', patch)
      .pipe(catchError(() => of(null)))
      .subscribe();
  }
}

/** Start the Preferences sync with the app, alongside provideTheme/provideLocale. */
export function providePreferencesSync(): EnvironmentProviders {
  return provideEnvironmentInitializer(() => void inject(PreferencesSync));
}
