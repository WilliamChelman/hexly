import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
} from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { TranslocoPipe } from '@jsverse/transloco';
import { ToasterService } from '../core/toaster.service';

/**
 * Renders the {@link ToasterService}'s transient messages as a stack of toasts
 * floating above everything (issue #64 follow-up). Mounted once in the app root,
 * it reads the service's `toasts` signal — so it re-renders as toasts come and go
 * — and offers a dismiss control per toast. A fixed overlay above the editor's
 * floating chrome (ADR-0013), it sits out of the layout flow and never steals
 * pointer events except on the toasts themselves.
 *
 * Copy is owned at the call site (the message is already-resolved text, ADR-0014);
 * only the dismiss control's label is translated here, reusing `common.close`.
 *
 * Each new toast is announced through CDK's {@link LiveAnnouncer} — a single,
 * always-present live region — rather than a `role="alert"` element inserted into
 * the DOM together with its text, which assistive tech routinely fails to announce
 * because the live region did not pre-exist. An `error` toast announces
 * assertively; the rest are polite status updates.
 */
@Component({
  selector: 'app-toaster',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  template: `
    @for (toast of toaster.toasts(); track toast.id) {
      <div
        class="toast"
        [class.is-info]="toast.tone === 'info'"
        [class.is-success]="toast.tone === 'success'"
        [class.is-error]="toast.tone === 'error'"
      >
        <span class="toast__message">{{ toast.message }}</span>
        <button
          type="button"
          class="toast__dismiss"
          data-testid="toast-dismiss"
          [attr.aria-label]="'common.close' | transloco"
          (click)="toaster.dismiss(toast.id)"
        >
          ✕
        </button>
      </div>
    }
  `,
  styles: `
    :host {
      /* A fixed column of toasts, bottom-centre, above the editor's floating
         chrome (ADR-0013). The host itself ignores the pointer so it never
         blocks the canvas; each toast re-enables it for its own controls. */
      position: fixed;
      left: 50%;
      bottom: var(--spacing-5, 1.5rem);
      transform: translateX(-50%);
      z-index: 1000;
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2, 0.5rem);
      align-items: center;
      pointer-events: none;
    }
    .toast {
      pointer-events: auto;
      display: flex;
      align-items: center;
      gap: var(--spacing-3, 0.75rem);
      max-width: min(90vw, 32rem);
      padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
      background: var(--color-surface-raised, var(--color-surface));
      color: var(--color-ink);
      border: 1px solid var(--color-line);
      border-left-width: 3px;
      border-radius: var(--radius-md, 8px);
      box-shadow: var(--shadow-2);
      font-size: 0.9rem;
    }
    .toast.is-error {
      border-left-color: var(--color-ember);
    }
    .toast.is-success {
      border-left-color: var(--color-terrain-forest, var(--color-ink));
    }
    .toast.is-info {
      border-left-color: var(--color-gold-strong, var(--color-ink));
    }
    .toast__message {
      flex: 1;
    }
    .toast__dismiss {
      flex: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.5rem;
      height: 1.5rem;
      padding: 0;
      background: transparent;
      border: 0;
      border-radius: var(--radius-sm, 4px);
      color: var(--color-ink-muted, var(--color-ink));
      font-size: 0.85rem;
      line-height: 1;
      cursor: pointer;
    }
    .toast__dismiss:hover {
      background: var(--color-surface-sunken, transparent);
      color: var(--color-ink);
    }
  `,
})
export class Toaster {
  protected readonly toaster = inject(ToasterService);
  private readonly liveAnnouncer = inject(LiveAnnouncer);
  /** Toast ids already announced, reconciled to the live set so it stays bounded. */
  private announced = new Set<number>();

  constructor() {
    // Announce every newly-shown toast through the always-present CDK live region;
    // ids already announced are skipped, and the set is pruned to the current toasts
    // so it cannot grow unbounded across a session.
    effect(() => {
      const toasts = this.toaster.toasts();
      for (const toast of toasts) {
        if (this.announced.has(toast.id)) continue;
        this.liveAnnouncer.announce(
          toast.message,
          toast.tone === 'error' ? 'assertive' : 'polite',
        );
      }
      this.announced = new Set(toasts.map((toast) => toast.id));
    });
  }
}
