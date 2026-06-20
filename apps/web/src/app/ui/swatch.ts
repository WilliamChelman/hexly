import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * A region/terrain swatch — a small coloured chip the domain uses to stand in
 * for a grouping. It owns its size/border/radius only; callers set the colour
 * via `[style.background]` or inline style. See ADR-0007.
 *
 *   <span appSwatch [style.background]="'var(--terrain-forest)'"></span>
 */
@Component({
  selector: '[appSwatch]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
  styles: `
    :host {
      width: var(--space-4);
      height: var(--space-4);
      border-radius: var(--radius-sm);
      border: 1px solid var(--line-strong);
      flex: none;
      box-shadow: var(--shadow-inset);
    }
  `,
})
export class Swatch {}
