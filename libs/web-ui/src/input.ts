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
    @reference '#app-styles.css';

    :host {
      @apply w-full py-2 px-3 text-sm text-ink-strong bg-surface-sunken border
        border-line-strong rounded-md shadow-inset;
      /* bespoke single-prop transition on the motion tokens — stays raw. */
      transition: border-color var(--dur-fast) var(--ease-out);
    }
    :host(:focus-visible) {
      @apply border-gold;
    }
  `,
})
export class Input {}
