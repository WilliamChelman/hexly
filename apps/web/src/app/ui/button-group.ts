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
    :host {
      display: inline-flex;
      border: 1px solid var(--color-line);
      border-radius: var(--radius-sm);
      overflow: hidden;
    }
    /* Strip each button's own frame so they read as one control; a hairline
       divider marks the seams. The group owns the border and rounding. */
    :host ::ng-deep [appButton] {
      border-radius: 0;
      border-color: transparent;
      box-shadow: none;
    }
    :host ::ng-deep [appButton]:hover {
      transform: none;
      box-shadow: none;
    }
    :host ::ng-deep [appButton] + [appButton] {
      border-left: 1px solid var(--color-line);
    }
  `,
})
export class ButtonGroup {}
