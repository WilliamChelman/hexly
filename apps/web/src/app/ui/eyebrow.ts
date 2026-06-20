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
  template: '<ng-content />',
  styles: `
    :host {
      font-family: var(--font-display);
      font-size: var(--text-2xs);
      font-weight: var(--weight-semibold);
      letter-spacing: var(--tracking-wider);
      text-transform: uppercase;
      color: var(--ink-muted);
    }
  `,
})
export class Eyebrow {}
