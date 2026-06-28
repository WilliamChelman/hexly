import { effect, Injectable, inject, Signal, signal, untracked } from '@angular/core';
import { AuthClient } from './auth.client';

function hashId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

// Records whose preferences localStorage currently holds, so the next login can
// tell "same user, keep" from "different user, discard".
const SCOPE_KEY = 'hexly-scope';

// Namespace for every key written through this store. Wiped wholesale on a
// cross-user login — kept distinct from device-level keys (e.g. `hexly-theme`)
// so those are never caught in the sweep.
const PREFIX = 'hexly-u:';

export interface AuthPreference<T extends string> {
  readonly value: Signal<T>;
  set(next: T): void;
}

/**
 * localStorage gateway for per-user preferences. Keys live under a shared
 * {@link PREFIX} (no per-user suffix); localStorage holds *one* user's
 * preferences at a time, tagged in {@link SCOPE_KEY} with whose they are. When a
 * *different* authenticated user is confirmed, every prefixed key is wiped so
 * preferences never leak across logout/re-login on the same browser.
 *
 * The wipe waits for a real authenticated user: while the session is anonymous —
 * logged out, a public-link viewer, or the brief window before `/auth/me`
 * resolves on boot — nothing is touched, so a returning user's choices survive
 * reload (flat keys are read with the same name they were written under,
 * regardless of when auth resolves).
 */
@Injectable({ providedIn: 'root' })
export class AuthScopedStorage {
  private readonly auth = inject(AuthClient);

  constructor() {
    effect(() => {
      const user = this.auth.currentUser();
      if (!user) return; // anonymous / in-flight: keep everything, decide on a real user
      untracked(() => {
        const newHash = hashId(user.id);
        try {
          const oldHash = localStorage.getItem(SCOPE_KEY);
          if (oldHash && oldHash !== newHash) {
            for (const key of Object.keys(localStorage)) {
              if (key.startsWith(PREFIX)) localStorage.removeItem(key);
            }
          }
          localStorage.setItem(SCOPE_KEY, newHash);
        } catch { /* private mode */ }
      });
    });
  }

  getItem(key: string): string | null {
    try {
      return localStorage.getItem(PREFIX + key);
    } catch {
      return null;
    }
  }

  setItem(key: string, value: string): void {
    try {
      localStorage.setItem(PREFIX + key, value);
    } catch { /* private mode */ }
  }

  removeItem(key: string): void {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch { /* private mode */ }
  }

  /**
   * A reactive preference: reads from storage on creation, applies it
   * immediately, and persists on every `set()` call. Discarded along with all
   * other prefixed keys when a different user logs in.
   */
  preference<T extends string>({
    storageKey,
    values,
    detect,
    apply,
  }: {
    storageKey: string;
    values: readonly T[];
    detect: () => T;
    apply: (value: T) => void;
  }): AuthPreference<T> {
    const read = (): T => {
      const stored = this.getItem(storageKey);
      if (stored !== null && (values as readonly string[]).includes(stored)) return stored as T;
      return detect();
    };
    const sig = signal<T>(read());
    apply(sig());
    return {
      value: sig.asReadonly(),
      set: (next: T) => {
        sig.set(next);
        apply(next);
        this.setItem(storageKey, next);
      },
    };
  }
}
