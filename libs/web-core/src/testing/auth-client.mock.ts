import { computed, signal } from '@angular/core';
import { EMPTY, Observable, of } from 'rxjs';
import { AuthUser, canManageUsers as canManageUsersRule, canCreateWorlds as canCreateWorldsRule } from '@hexly/domain';

export class MockAuthClient {
  private readonly _user = signal<AuthUser | null>(null);
  readonly currentUser = this._user.asReadonly();
  readonly isAuthenticated = computed(() => this._user() !== null);
  readonly canManageUsers = computed(() => {
    const u = this._user();
    return !!u && canManageUsersRule(u);
  });
  readonly isSuperadmin = computed(() => this._user()?.isSuperadmin ?? false);
  readonly canCreateWorlds = computed(() => {
    const u = this._user();
    return !!u && canCreateWorldsRule(u);
  });

  private readonly _loading = signal(false);
  readonly sessionLoading = this._loading.asReadonly();

  setUser(user: AuthUser | null): void {
    this._user.set(user);
  }
  setLoading(loading: boolean): void {
    this._loading.set(loading);
  }

  login = vi.fn<(email: string, password: string) => Observable<AuthUser>>(() => EMPTY);
  logout = vi.fn<() => Observable<void>>(() => of(undefined));
  signOut = vi.fn();
  updateProfile = vi.fn<(displayName: string) => Observable<AuthUser>>(() => EMPTY);
  changePassword = vi.fn<(currentPassword: string, newPassword: string) => Observable<void>>(() => of(undefined));
}
