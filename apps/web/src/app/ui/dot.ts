import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  input,
} from '@angular/core';

/**
 * A small status dot. `positive` turns it into a healthy/lit dot with a soft
 * halo. See ADR-0007.
 *
 *   <span appDot [positive]="healthy()"></span>
 */
@Component({
  selector: '[appDot]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.is-positive]': 'positive()',
  },
  template: '',
  styles: `
    :host {
      width: 8px;
      height: 8px;
      border-radius: var(--radius-full);
      background: var(--ink-faint);
      flex: none;
    }
    :host(.is-positive) {
      background: var(--positive);
      box-shadow: 0 0 0 3px var(--positive-soft);
    }
  `,
})
export class Dot {
  /** A healthy/lit dot — green with a soft halo. */
  readonly positive = input(false, { transform: booleanAttribute });
}
