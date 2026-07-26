import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * A region/terrain swatch — a small coloured chip the domain uses to stand in
 * for a grouping. It owns its size/border/radius only; callers set the colour
 * via `[style.background]` or inline style. See ADR-0007. The example takes a semantic role: a core
 * primitive does not know a plugin's vocabulary, which is tier 3 and lives in the plugin (ADR-0075).
 *
 *   <span appSwatch [style.background]="'var(--color-success)'"></span>
 */
@Component({
  selector: '[appSwatch]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'w-4 h-4 rounded-sm border border-line-strong flex-none shadow-inset',
  },
  template: '',
})
export class SwatchComponent {}
