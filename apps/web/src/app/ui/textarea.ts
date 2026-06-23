import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * A multi-line text input — the shared sunken-well field styling plus the
 * textarea-only sizing. Uses an attribute selector on the native `<textarea>`,
 * so it keeps its value, form participation and a11y, and projects its content.
 * See ADR-0007.
 *
 *   <textarea appTextarea>A walled town…</textarea>
 */
@Component({
  selector: 'textarea[appTextarea]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
  styles: `
    :host {
      width: 100%;
      padding: var(--spacing-2) var(--spacing-3);
      font-size: var(--text-sm);
      color: var(--color-ink-strong);
      background: var(--color-surface-sunken);
      border: 1px solid var(--color-line-strong);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-inset);
      transition: border-color var(--dur-fast) var(--ease-out);
      resize: vertical;
      min-height: 5rem;
      line-height: var(--leading-snug);
    }
    :host(:focus-visible) {
      border-color: var(--color-gold);
    }
  `,
})
export class Textarea {}
