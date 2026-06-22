import { signal, Signal } from '@angular/core';

/** How to detect, validate, persist, and apply a single client-owned preference. */
export interface PersistedPreferenceOptions<T extends string> {
  /** The `localStorage` key the choice is remembered under (e.g. `hexly-theme`). */
  readonly storageKey: string;
  /** The allowed values; a stored string outside this set is ignored. */
  readonly values: readonly T[];
  /** First-visit fallback when nothing valid is stored (browser/OS detection). */
  readonly detect: () => T;
  /** Reflect a value onto the world (e.g. `<html data-theme>`, Transloco's lang). */
  readonly apply: (value: T) => void;
}

/** A reactive, persisted preference: read its {@link value}, change it with {@link set}. */
export interface PersistedPreference<T extends string> {
  /** The active value, readable by the UI. */
  readonly value: Signal<T>;
  /** Change the value: applies it live and remembers it for the next visit. */
  set(next: T): void;
}

/**
 * The one client-owned-preference mechanism shared by {@link ThemeService} and
 * {@link LocaleService} (ADR-0014/0015): a remembered choice wins, else first-visit
 * detection; the choice is reflected onto the world via {@link PersistedPreferenceOptions.apply}
 * and persisted to `localStorage`. Both services are thin wrappers so theme and
 * locale can't drift on the detect → remember → apply behaviour that matters.
 */
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
  // Reflect the resolved choice immediately so the first paint is correct.
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
