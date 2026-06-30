import { TestBed } from '@angular/core/testing';
import { AuthClient } from './auth.client';
import { MockAuthClient } from '../testing/auth-client.mock';
import { AuthScopedStorage } from './auth-scoped-storage';

describe('AuthScopedStorage', () => {
  let storage: AuthScopedStorage;
  let auth: MockAuthClient;

  function login(id: string): void {
    auth.setUser({ id, email: `${id}@test.com`, displayName: id });
    TestBed.flushEffects();
  }

  function logout(): void {
    auth.setUser(null);
    TestBed.flushEffects();
  }

  beforeEach(() => {
    localStorage.clear();
    auth = new MockAuthClient();
    TestBed.configureTestingModule({
      providers: [{ provide: AuthClient, useValue: auth }],
    });
    storage = TestBed.inject(AuthScopedStorage);
    // Flush effects to process the initial (anonymous) auth-scoped-storage effect.
    TestBed.flushEffects();
  });

  afterEach(() => localStorage.clear());

  describe('getItem / setItem / removeItem', () => {
    it('reads and writes under a prefixed key, not the bare key', () => {
      login('u1');
      storage.setItem('foo', 'bar');
      expect(storage.getItem('foo')).toBe('bar');
      expect(localStorage.getItem('hexly-u:foo')).toBe('bar'); // namespaced internally
      expect(localStorage.getItem('foo')).toBeNull(); // bare key untouched
    });

    it('getItem returns null when nothing is stored', () => {
      login('u1');
      expect(storage.getItem('foo')).toBeNull();
    });

    it('removeItem deletes the key', () => {
      login('u1');
      storage.setItem('foo', 'bar');
      storage.removeItem('foo');
      expect(storage.getItem('foo')).toBeNull();
    });

    it('reads back regardless of auth timing — written logged-in, read while anonymous', () => {
      // The reload bug: a value written by a logged-in user must read back the
      // same when the session is anonymous (as on boot before /auth/me resolves),
      // since the key carries no user suffix to miss.
      login('u1');
      storage.setItem('foo', 'bar');
      logout();

      expect(storage.getItem('foo')).toBe('bar');
    });
  });

  describe('auto-wipe on user change', () => {
    it('does NOT wipe keys on logout — they persist until a different user logs in', () => {
      login('u1');
      storage.setItem('foo', 'bar');

      logout();

      // Keys survive logout so a same-user re-login still sees preferences.
      expect(storage.getItem('foo')).toBe('bar');
    });

    it('wipes user A keys when user B logs in on the same tab', () => {
      login('u1');
      storage.setItem('foo', 'from-u1');

      login('u2');

      expect(storage.getItem('foo')).toBeNull();
      // User B writes their own value under the same key
      storage.setItem('foo', 'from-u2');
      expect(storage.getItem('foo')).toBe('from-u2');
    });

    it('cleans up stale keys from a prior session when a different user logs in', () => {
      // Simulate a prior session: login as u1, write a key, then logout.
      // Logout keeps SCOPE_KEY so the next login can compare and wipe.
      login('u1');
      storage.setItem('pref', 'stale-value');
      logout();

      // A different user logs in — the prior-session keys must be wiped.
      login('u2');

      expect(storage.getItem('pref')).toBeNull();
    });

    it('preserves keys when the same user re-authenticates', () => {
      login('u1');
      storage.setItem('foo', 'kept');
      logout();

      // Same user logs back in — preferences survive the logout/re-login cycle.
      login('u1');

      expect(storage.getItem('foo')).toBe('kept');
    });

    it('does not wipe while the session is anonymous', () => {
      login('u1');
      storage.setItem('foo', 'bar');
      logout(); // currentUser → null; must not wipe

      expect(storage.getItem('foo')).toBe('bar');
    });

    it('leaves non-prefixed keys (e.g. device-level theme) untouched on a cross-user login', () => {
      login('u1');
      localStorage.setItem('hexly-theme', 'dark'); // device-level, not via this store
      storage.setItem('foo', 'from-u1');

      login('u2');

      expect(storage.getItem('foo')).toBeNull(); // scoped key wiped
      expect(localStorage.getItem('hexly-theme')).toBe('dark'); // device key kept
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
      storage.setItem('hexly-theme', 'dark');
      const pref = storage.preference({
        storageKey: 'hexly-theme',
        values: ['light', 'dark'] as const,
        detect: () => 'light' as const,
        apply: vi.fn(),
      });

      expect(pref.value()).toBe('dark');
    });

    it('ignores stored values not in the values list', () => {
      storage.setItem('hexly-theme', 'solarized'); // not a valid value
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

    it('reads the stored value when authenticated', () => {
      login('u1');
      storage.setItem('hexly-theme', 'dark');
      const pref = storage.preference({
        storageKey: 'hexly-theme',
        values: ['light', 'dark'] as const,
        detect: () => 'light' as const,
        apply: vi.fn(),
      });

      expect(pref.value()).toBe('dark');
      expect(localStorage.getItem('hexly-u:hexly-theme')).toBe('dark'); // namespaced
    });
  });
});
