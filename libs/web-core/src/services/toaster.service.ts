import { Injectable, signal } from '@angular/core';

/** A toast's severity; the {@link Toaster} component maps it onto tone styling. */
export type ToastTone = 'info' | 'success' | 'error';

/** One transient on-screen message: a stable `id`, its `message`, and its `tone`. */
export interface Toast {
  readonly id: number;
  readonly message: string;
  readonly tone: ToastTone;
}

/** How long a toast lingers before auto-dismissing, unless overridden per call. */
const DEFAULT_TOAST_DURATION_MS = 4000;

/**
 * A signal-backed queue of {@link Toast}s any feature can raise. Copy-agnostic:
 * callers pass an already-resolved string, so i18n lives at the call site. Each
 * `show` auto-dismisses after its duration; `0` keeps the toast until
 * {@link dismiss} or {@link clear}.
 */
@Injectable({ providedIn: 'root' })
export class ToasterService {
  private readonly _toasts = signal<readonly Toast[]>([]);
  /** The active toasts, oldest first — the {@link Toaster} renders these. */
  readonly toasts = this._toasts.asReadonly();

  /** A monotonic id source, so each toast is addressable for dismissal. */
  private nextId = 0;

  /** Auto-dismiss timers by toast id, so an early dismiss/clear cancels the pending timer. */
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  /**
   * Raise a toast, returning its id. Pass `durationMs` of `0` to keep it until
   * dismissed. The timer is skipped where `setTimeout` is unavailable (SSR).
   */
  show(message: string, tone: ToastTone = 'info', durationMs = DEFAULT_TOAST_DURATION_MS): number {
    const id = this.nextId++;
    this._toasts.update((list) => [...list, { id, message, tone }]);
    if (durationMs > 0 && typeof setTimeout === 'function') {
      this.timers.set(
        id,
        setTimeout(() => this.dismiss(id), durationMs),
      );
    }
    return id;
  }

  /** Remove the toast with `id`, if it is still showing; a no-op otherwise. */
  dismiss(id: number): void {
    this.cancelTimer(id);
    this._toasts.update((list) => list.filter((toast) => toast.id !== id));
  }

  /** Remove every toast at once. */
  clear(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this._toasts.set([]);
  }

  /** Cancel and forget the auto-dismiss timer for `id`, if one is pending. */
  private cancelTimer(id: number): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }
}
