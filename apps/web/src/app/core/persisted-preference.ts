import { signal, Signal } from '@angular/core';

/** How to detect, validate, persist, and apply a single client-owned preference. */
export interface PersistedPreferenceOptions<T extends string> {
  readonly storageKey: string;
  readonly values: readonly T[];
  /** First-visit fallback when nothing valid is stored. */
  readonly detect: () => T;
  /** Reflect a value onto the world (e.g. `<html data-theme>`). */
  readonly apply: (value: T) => void;
}

/** A reactive, persisted preference: read its {@link value}, change it with {@link set}. */
export interface PersistedPreference<T extends string> {
  readonly value: Signal<T>;
  set(next: T): void;
}

/** Read, apply, and persist a client preference to `localStorage`. */
export function persistedPreference<T extends string>({
  storageKey,
  values,
  detect,
  apply,
}: PersistedPreferenceOptions<T>): PersistedPreference<T> {
  const read = (): T => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null && (values as readonly string[]).includes(stored)) {
        return stored as T;
      }
    } catch {
      /* storage may be unavailable (private mode); fall through to detection */
    }
    return detect();
  };

  const value = signal<T>(read());
  apply(value());

  return {
    value: value.asReadonly(),
    set(next: T): void {
      value.set(next);
      apply(next);
      try {
        localStorage.setItem(storageKey, next);
      } catch {
        /* storage may be unavailable (private mode); the in-memory value holds */
      }
    },
  };
}
