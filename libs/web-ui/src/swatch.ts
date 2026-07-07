import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * A region/terrain swatch — a small coloured chip the domain uses to stand in
 * for a grouping. It owns its size/border/radius only; callers set the colour
 * via `[style.background]` or inline style. See ADR-0007.
 *
 *   <span appSwatch [style.background]="'var(--color-terrain-forest)'"></span>
 */
@Component({
  selector: '[appSwatch]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'w-4 h-4 rounded-sm border border-line-strong flex-none shadow-inset',
  },
  template: '',
})
export class Swatch {}
