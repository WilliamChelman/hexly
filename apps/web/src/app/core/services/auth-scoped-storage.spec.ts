import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthClient } from './auth.client';
import { AuthScopedStorage } from './auth-scoped-storage';

describe('AuthScopedStorage', () => {
  let storage: AuthScopedStorage;
  let http: HttpTestingController;

  function login(id: string): void {
    TestBed.inject(AuthClient)
      .login(`${id}@test.com`, 'pw')
      .subscribe();
    http.expectOne('/api/auth/login').flush({ id, email: `${id}@test.com`, displayName: id });
    TestBed.flushEffects();
  }

  function logout(): void {
    TestBed.inject(AuthClient).logout().subscribe();
    http.expectOne('/api/auth/logout').flush(null);
    TestBed.flushEffects();
  }

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    storage = TestBed.inject(AuthScopedStorage);
    http = TestBed.inject(HttpTestingController);
    TestBed.flushEffects(); // initial effect: user = null, nothing to wipe
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  describe('userKey()', () => {
    it('returns the bare key when no user is authenticated', () => {
      expect(storage.userKey('hexly-foo')).toBe('hexly-foo');
    });

    it('returns a namespaced key once a user is authenticated', () => {
      login('u1');
      expect(storage.userKey('hexly-foo')).toMatch(/^hexly-foo-.+$/);
    });

    it('returns different namespaced keys for different users', () => {
      login('u1');
      const keyForU1 = storage.userKey('hexly-foo');
      login('u2');
      const keyForU2 = storage.userKey('hexly-foo');
      expect(keyForU1).not.toBe(keyForU2);
    });
  });

  describe('getItem / setItem / removeItem', () => {
    it('reads and writes under the user-scoped key, not the bare key', () => {
      login('u1');
      storage.setItem('hexly-foo', 'bar');
      expect(storage.getItem('hexly-foo')).toBe('bar');
      expect(localStorage.getItem('hexly-foo')).toBeNull(); // bare key untouched
    });

    it('getItem returns null when nothing is stored', () => {
      login('u1');
      expect(storage.getItem('hexly-foo')).toBeNull();
    });

    it('removeItem deletes the user-scoped key', () => {
      login('u1');
      storage.setItem('hexly-foo', 'bar');
      storage.removeItem('hexly-foo');
      expect(storage.getItem('hexly-foo')).toBeNull();
    });
  });

  describe('auto-wipe on user change', () => {
    it('does NOT wipe user-scoped keys on logout — they persist until a different user logs in', () => {
      login('u1');
      const scopedKey = storage.userKey('hexly-foo');
      storage.setItem('hexly-foo', 'bar');

      logout();

      // Keys survive logout so a same-user re-login still sees preferences.
      expect(localStorage.getItem(scopedKey)).toBe('bar');
    });

    it('wipes user A keys when user B logs in on the same tab', () => {
      login('u1');
      const u1ScopedKey = storage.userKey('hexly-foo');
      storage.setItem('hexly-foo', 'from-u1');

      login('u2');

      expect(localStorage.getItem(u1ScopedKey)).toBeNull();
      // User B can still write their own separate scoped key
      storage.setItem('hexly-foo', 'from-u2');
      expect(storage.getItem('hexly-foo')).toBe('from-u2');
    });

    it('cleans up stale keys from a prior session when a different user logs in', () => {
      // Simulate a prior session: login as u1, write a key, then logout.
      // Logout keeps SCOPE_KEY so the next login can compare and wipe.
      login('u1');
      const staleScopedKey = storage.userKey('hexly-pref');
      storage.setItem('hexly-pref', 'stale-value');
      logout();

      // A different user logs in — the prior-session keys must be wiped.
      login('u2');

      expect(localStorage.getItem(staleScopedKey)).toBeNull();
    });

    it('preserves scoped keys when the same user re-authenticates', () => {
      login('u1');
      storage.setItem('hexly-foo', 'kept');
      const scopedKey = storage.userKey('hexly-foo');
      logout();

      // Same user logs back in — preferences survive the logout/re-login cycle.
      login('u1');

      expect(localStorage.getItem(scopedKey)).toBe('kept');
    });
  });

  describe('preference()', () => {
    it('falls back to detect() when nothing is stored', () => {
      const apply = vi.fn();
      const pref = storage.preference({
        storageKey: 'hexly-theme',
        values: ['light', 'dark'] as const,
        detect: () => 'light' as const,
        apply,
      });

      expect(pref.value()).toBe('light');
      expect(apply).toHaveBeenCalledWith('light');
    });

    it('reads the stored value instead of detecting', () => {
      // bare key (no authenticated user)
      localStorage.setItem('hexly-theme', 'dark');
      const pref = storage.preference({
        storageKey: 'hexly-theme',
        values: ['light', 'dark'] as const,
        detect: () => 'light' as const,
        apply: vi.fn(),
      });

      expect(pref.value()).toBe('dark');
    });

    it('ignores stored values not in the values list', () => {
      localStorage.setItem('hexly-theme', 'solarized'); // not a valid value
      const pref = storage.preference({
        storageKey: 'hexly-theme',
        values: ['light', 'dark'] as const,
        detect: () => 'light' as const,
        apply: vi.fn(),
      });

      expect(pref.value()).toBe('light');
    });

    it('set() updates the signal, calls apply, and persists to storage', () => {
      const apply = vi.fn();
      const pref = storage.preference({
        storageKey: 'hexly-theme',
        values: ['light', 'dark'] as const,
        detect: () => 'light' as const,
        apply,
      });

      pref.set('dark');

      expect(pref.value()).toBe('dark');
      expect(apply).toHaveBeenLastCalledWith('dark');
      expect(storage.getItem('hexly-theme')).toBe('dark');
    });

    it('reads from the user-scoped key when authenticated', () => {
      login('u1');
      storage.setItem('hexly-theme', 'dark'); // writes user-scoped key
      const pref = storage.preference({
        storageKey: 'hexly-theme',
        values: ['light', 'dark'] as const,
        detect: () => 'light' as const,
        apply: vi.fn(),
      });

      expect(pref.value()).toBe('dark');
      // Bare key is untouched
      expect(localStorage.getItem('hexly-theme')).toBeNull();
    });
  });
});
