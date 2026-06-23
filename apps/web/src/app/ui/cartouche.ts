import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * The cartouche wordmark treatment — an uppercase display-face label. Uses an
 * attribute selector so it keeps its host element. Projects its content.
 * See ADR-0007.
 *
 *   <span appCartouche>Hexly</span>
 */
@Component({
  selector: '[appCartouche]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
  styles: `
    :host {
      font-family: var(--font-display);
      font-weight: var(--font-weight-semibold);
      letter-spacing: var(--tracking-wider);
      text-transform: uppercase;
    }
  `,
})
export class Cartouche {}
