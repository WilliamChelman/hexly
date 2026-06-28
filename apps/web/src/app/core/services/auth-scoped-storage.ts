import { effect, Injectable, inject, Signal, signal, untracked } from '@angular/core';
import { AuthClient } from './auth.client';

function hashId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

// Stores the current user's hash so the next login can identify and clear the previous user's keys.
const SCOPE_KEY = 'hexly-scope';

export interface AuthPreference<T extends string> {
  readonly value: Signal<T>;
  set(next: T): void;
}

/**
 * localStorage proxy that namespaces every key by a hash of the current user id —
 * prevents per-user preferences from leaking across logout/re-login on the same
 * browser tab. On user change, automatically wipes all previously-written scoped
 * keys so consumers never have to manage cross-session cleanup themselves.
 */
@Injectable({ providedIn: 'root' })
export class AuthScopedStorage {
  private readonly auth = inject(AuthClient);

  constructor() {
    effect(() => {
      const user = this.auth.currentUser();
      untracked(() => {
        const newHash = user ? hashId(user.id) : null;
        try {
          const oldHash = localStorage.getItem(SCOPE_KEY);
          if (oldHash && oldHash !== newHash) {
            const suffix = `-${oldHash}`;
            for (const key of Object.keys(localStorage)) {
              if (key.endsWith(suffix)) localStorage.removeItem(key);
            }
          }
          if (newHash) localStorage.setItem(SCOPE_KEY, newHash);
          else localStorage.removeItem(SCOPE_KEY);
        } catch { /* private mode */ }
      });
    });
  }

  userKey(base: string): string {
    const user = this.auth.currentUser();
    return user ? `${base}-${hashId(user.id)}` : base;
  }

  getItem(base: string): string | null {
    try {
      return localStorage.getItem(this.userKey(base));
    } catch {
      return null;
    }
  }

  setItem(base: string, value: string): void {
    try {
      localStorage.setItem(this.userKey(base), value);
    } catch { /* private mode */ }
  }

  removeItem(base: string): void {
    try {
      localStorage.removeItem(this.userKey(base));
    } catch { /* private mode */ }
  }

  /**
   * A reactive, auth-scoped preference: reads from user-scoped storage on
   * creation, applies it immediately, and persists on every `set()` call.
   * Auto-wiped on user change along with all other scoped keys.
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
