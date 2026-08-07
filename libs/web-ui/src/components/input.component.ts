import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * A single-line text input — the shared sunken-well field styling. Attribute
 * selector on the native `<input>`, so it keeps its type, value, form
 * participation and a11y. A void element, hence no template. See ADR-0007.
 *
 *   <input appInput value="The Reach of Aldermoor" />
 *
 * The `compact` variant trims the padding, centres the text, and drops the
 * number spinners so a single digit stays legible in a tight grid cell (the
 * stat-block characteristic squares) — the default padding clips it there.
 *
 *   <input appInput compact type="number" />
 *
 * The `bar` variant is the browse surfaces' search bar — raised rather than sunken, larger type, and
 * the leading room an overlaid glyph needs. It is a variant here rather than a class string a caller
 * hands the box, because a consumer cannot restyle a primitive's host from outside (ADR-0021).
 *
 *   <input appInput bar type="search" />
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
    /* Before the focus rule, which it ties on specificity: the focused border must still win. */
    :host([bar]) {
      @apply pl-10 pr-3 py-2.5 font-sans text-md bg-surface border-line rounded-sm shadow-none;
    }
    :host(:focus-visible) {
      @apply border-accent;
    }
    :host([compact]) {
      @apply px-1 py-1 text-center;
      /* Drop the spinners (Firefox) so the value, not the stepper, owns the width. */
      appearance: textfield;
    }
    /* Drop the spinners (WebKit/Blink) for the same reason. */
    :host([compact])::-webkit-inner-spin-button,
    :host([compact])::-webkit-outer-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
  `,
})
export class InputComponent {}
