import { Injectable, signal } from '@angular/core';

/**
 * A toast's severity, which the {@link Toaster} component maps onto its tone
 * styling: a neutral `info`, a positive `success`, or a problem `error` (e.g. a
 * refused move). Presentation only — the service stays unaware of how it's drawn.
 */
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
 * The app's transient notifications (issue #64 follow-up): a small queue of
 * {@link Toast}s any feature can raise to tell the user something happened — a
 * refused drag, a saved map — without owning its own banner UI. Signal-backed in
 * the same shape as the other app services (a private writable signal exposed
 * read-only), so the {@link Toaster} component re-renders as toasts come and go.
 *
 * Deliberately copy-agnostic: callers pass an already-resolved string, so the
 * service carries no Transloco dependency and the i18n lives at the call site
 * (ADR-0014). Each `show` auto-dismisses after its duration; a duration of `0`
 * keeps the toast until {@link dismiss} or {@link clear}.
 */
@Injectable({ providedIn: 'root' })
export class ToasterService {
  private readonly _toasts = signal<readonly Toast[]>([]);
  /** The active toasts, oldest first — the {@link Toaster} renders these. */
  readonly toasts = this._toasts.asReadonly();

  /** A monotonic id source, so each toast is addressable for dismissal. */
  private nextId = 0;

  /**
   * The live auto-dismiss timers, keyed by toast id, so an early {@link dismiss} or
   * {@link clear} can cancel the pending timer instead of leaving it to fire a late
   * no-op (and pile up under bursty toasting).
   */
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  /**
   * Raise a toast with `message` and `tone` (default `info`), returning its id so
   * the caller can dismiss it early. It auto-dismisses after `durationMs`; pass
   * `0` to keep it until dismissed. The timer is best-effort — it is skipped where
   * `setTimeout` is unavailable, so the service is safe to construct under SSR.
   */
  show(
    message: string,
    tone: ToastTone = 'info',
    durationMs = DEFAULT_TOAST_DURATION_MS,
  ): number {
    const id = this.nextId++;
    this._toasts.update((list) => [...list, { id, message, tone }]);
    if (durationMs > 0 && typeof setTimeout === 'function') {
      this.timers.set(id, setTimeout(() => this.dismiss(id), durationMs));
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
