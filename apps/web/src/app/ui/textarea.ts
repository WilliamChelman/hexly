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
    @reference '#app-styles.css';

    :host {
      @apply w-full py-2 px-3 text-sm text-ink-strong bg-surface-sunken border
        border-line-strong rounded-md shadow-inset resize-y min-h-20 leading-snug;
      /* bespoke single-prop transition on the motion tokens — stays raw. */
      transition: border-color var(--dur-fast) var(--ease-out);
    }
    :host(:focus-visible) {
      @apply border-gold;
    }
  `,
})
export class Textarea {}
