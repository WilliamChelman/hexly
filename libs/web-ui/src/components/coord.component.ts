import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * A coordinate pill — the app's signature mono detail. See ADR-0007.
 *
 *   <app-coord>q 0 · r 0</app-coord>
 */
@Component({
  selector: 'app-coord',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'font-mono text-2xs tracking-[0.02em] text-ink-muted bg-surface-sunken border border-line rounded-sm py-[1px] px-2',
  },
  template: `<ng-content />`,
})
export class CoordComponent {}
