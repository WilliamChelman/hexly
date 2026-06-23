import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * A small uppercase section eyebrow/label. Uses an attribute selector so it
 * keeps its host element (`<span>`, `<h2>`, `<figcaption>`…). Projects its
 * content. See ADR-0007.
 *
 *   <span appEyebrow>Hex map</span>
 *   <h2 appEyebrow>Terrain</h2>
 */
@Component({
  selector: '[appEyebrow]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'font-display text-2xs font-semibold tracking-wider uppercase text-ink-muted',
  },
  template: '<ng-content />',
})
export class Eyebrow {}
