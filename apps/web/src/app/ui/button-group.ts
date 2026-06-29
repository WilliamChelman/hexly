import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Joins child {@link Button}s into a single segmented control: one shared border,
 * rounded ends, segments sitting flush. Pair with `appButton [active]` for an
 * exclusive choice — the consumer owns `aria-pressed`/`aria-label` and selection.
 * See ADR-0007.
 *
 *   <div appButtonGroup [attr.aria-label]="'View' | transloco">
 *     <button appButton variant="ghost" size="sm" [active]="…" aria-pressed="…">Map</button>
 *     <button appButton variant="ghost" size="sm" [active]="…" aria-pressed="…">Note</button>
 *   </div>
 */
@Component({
  selector: '[appButtonGroup]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'group' },
  template: `<ng-content />`,
  styles: `
    @reference '../../styles.css';

    :host {
      @apply inline-flex border border-line rounded-sm overflow-hidden;
    }
    /* Strip each button's own frame so they read as one control; a hairline
       divider marks the seams. The group owns the border and rounding. */
    :host ::ng-deep [appButton] {
      @apply rounded-none border-transparent shadow-none;
    }
    :host ::ng-deep [appButton]:hover {
      @apply transform-none shadow-none;
    }
    :host ::ng-deep [appButton] + [appButton] {
      @apply border-l border-l-line;
    }
  `,
})
export class ButtonGroup {}
