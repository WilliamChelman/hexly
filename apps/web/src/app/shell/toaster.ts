import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
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
 * An `error` toast announces assertively (`role="alert"`); the rest are polite
 * status updates.
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
        [attr.role]="toast.tone === 'error' ? 'alert' : 'status'"
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
      bottom: var(--space-5, 1.5rem);
      transform: translateX(-50%);
      z-index: 1000;
      display: flex;
      flex-direction: column;
      gap: var(--space-2, 0.5rem);
      align-items: center;
      pointer-events: none;
    }
    .toast {
      pointer-events: auto;
      display: flex;
      align-items: center;
      gap: var(--space-3, 0.75rem);
      max-width: min(90vw, 32rem);
      padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
      background: var(--surface-raised, var(--surface));
      color: var(--ink);
      border: 1px solid var(--line);
      border-left-width: 3px;
      border-radius: var(--radius-md, 8px);
      box-shadow: var(--shadow-2);
      font-size: 0.9rem;
    }
    .toast.is-error {
      border-left-color: var(--ember);
    }
    .toast.is-success {
      border-left-color: var(--terrain-forest, var(--ink));
    }
    .toast.is-info {
      border-left-color: var(--gold-strong, var(--ink));
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
      color: var(--ink-soft, var(--ink));
      font-size: 0.85rem;
      line-height: 1;
      cursor: pointer;
    }
    .toast__dismiss:hover {
      background: var(--surface-sunken, transparent);
      color: var(--ink);
    }
  `,
})
export class Toaster {
  protected readonly toaster = inject(ToasterService);
}
