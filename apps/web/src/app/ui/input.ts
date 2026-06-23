import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * A single-line text input — the shared sunken-well field styling. Uses an
 * attribute selector on the native `<input>`, so it keeps its type, value, form
 * participation and a11y. It is a void element, so it owns no template.
 * See ADR-0007.
 *
 *   <input appInput value="The Reach of Aldermoor" />
 */
@Component({
  selector: 'input[appInput]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
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
    }
    :host(:focus-visible) {
      border-color: var(--color-gold);
    }
  `,
})
export class Input {}
