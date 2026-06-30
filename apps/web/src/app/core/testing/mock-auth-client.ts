import { computed, signal } from '@angular/core';
import { EMPTY, Observable, of } from 'rxjs';
import { AuthUser } from '@hexly/domain';

export class MockAuthClient {
  private readonly _user = signal<AuthUser | null>(null);
  readonly currentUser = this._user.asReadonly();
  readonly isAuthenticated = computed(() => this._user() !== null);

  setUser(user: AuthUser | null): void { this._user.set(user); }

  login(): Observable<never> { return EMPTY; }
  logout(): Observable<void> { return of(undefined); }
  signOut(): void {
    /* no-op: tests that care about sign-out drive currentUser via setUser() */
  }
}
