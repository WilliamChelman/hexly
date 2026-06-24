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
  host: {
    class: 'font-display font-semibold tracking-wider uppercase',
  },
  template: '<ng-content />',
})
export class Cartouche {}
