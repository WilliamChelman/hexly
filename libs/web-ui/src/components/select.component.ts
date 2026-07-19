import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * A dropdown — the shared sunken-well field styling of {@link Input} on a
 * native `<select>`, with the OS arrow swapped for the app's chevron. Uses an
 * attribute selector so the element keeps its options, form participation,
 * keyboard behaviour and a11y; the `<option>` children project through.
 * See ADR-0007.
 *
 * Where the browser supports the customizable select (`appearance:
 * base-select`, Chromium 135+), the picker panel and its options are styled to
 * match the app's CDK menus — still the native element, no JS. Elsewhere the
 * OS-rendered dropdown shows: same behaviour, stock look.
 *
 *   <select appSelect [value]="role()" (change)="…">
 *     <option value="viewer">Viewer</option>
 *   </select>
 */
@Component({
  selector: 'select[appSelect]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-content />`,
  styles: `
    @reference '#app-styles.css';

    :host {
      @apply appearance-none py-2 px-3 pr-9 text-sm text-ink-strong
        bg-surface-sunken border border-line-strong rounded-md shadow-inset
        cursor-pointer;
      /* Pre-base-select fallback: the chevron rides as a background so the native element stays a plain
         <select> (base-select browsers replace this with an in-flow picker-icon below). data-uris cannot
         read CSS vars, so its stroke is a fixed warm gray legible on the sunken well in both themes. */
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23968f7f' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 0.75rem center;
      background-size: 1rem;
      /* bespoke single-prop transition on the motion tokens — stays raw. */
      transition: border-color var(--dur-fast) var(--ease-out);
    }
    :host(:hover) {
      @apply border-gold;
    }
    :host(:focus-visible) {
      @apply outline-none border-gold;
    }
    :host(:disabled) {
      @apply opacity-50 cursor-not-allowed;
    }

    /* Customizable select, where supported: both the element and its picker
       must opt in via base-select for ::picker(select) to apply. The panel
       mirrors the CDK menu look (user-menu); options are the consumer's
       projected light DOM, so they carry the consumer's scope attribute, not
       ours — ::ng-deep (scoped under :host) is the supported way through. */
    @supports (appearance: base-select) {
      :host,
      :host::picker(select) {
        appearance: base-select;
      }
      :host(:open) {
        @apply border-gold;
      }
      /* In base-select the chevron is a real in-flow element (the native picker-icon), so it follows the
         value rather than floating over it the way a background image does — long text can never slide
         under it. Drop the background chevron and its reserved right pad here, and paint the app's own
         chevron onto the icon so the look is unchanged. */
      :host {
        background-image: none;
        @apply pr-1 flex items-center;
      }
      :host::picker-icon {
        appearance: none;
        width: 1rem;
        height: 1rem;
        /* auto margin right-aligns; the min keeps a gap so long values never butt against the chevron. */
        margin-left: auto;
        padding-left: 0.5rem;
        box-sizing: content-box;
        color: transparent;
        background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23968f7f' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")
          no-repeat center / 1rem;
        transition: transform var(--dur-fast) var(--ease-out);
      }
      :host(:open)::picker-icon {
        transform: rotate(180deg);
      }
      :host::picker(select) {
        @apply mt-1 p-1 bg-surface-raised border border-line rounded-md shadow-2;
      }
      :host ::ng-deep option {
        @apply flex items-center gap-2 px-3 py-2 text-sm text-ink rounded-sm
          cursor-pointer;
      }
      :host ::ng-deep option:hover,
      :host ::ng-deep option:focus-visible {
        @apply bg-gold-soft outline-none;
      }
      :host ::ng-deep option:checked {
        @apply text-ink-strong;
      }
      /* The check rides at the row's end, like the CDK menus (user-menu). */
      :host ::ng-deep option::checkmark {
        @apply order-1 ml-auto text-gold;
      }
    }
  `,
})
export class SelectComponent {}
