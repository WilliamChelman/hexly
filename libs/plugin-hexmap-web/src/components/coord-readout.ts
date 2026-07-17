import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Axial } from '@hexly/plugin-hexmap';

/**
 * Map's hover readout showing coordinate and terrain. Purely presentational; the canvas owns
 * hover state (ADR-0003). Inert to pointer.
 */
@Component({
  selector: 'app-coord-readout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'flex items-center gap-1 font-mono text-xs text-ink-muted py-[7px] px-3 border border-line rounded-lg shadow-1 backdrop-blur-[4px] pointer-events-none',
  },
  imports: [TranslocoPipe],
  template: `
    q <b class="font-semibold text-gold-strong">{{ coord()?.q ?? 0 }}</b> · r
    <b class="font-semibold text-gold-strong">{{ coord()?.r ?? 0 }}</b> ·
    <b class="font-semibold text-gold-strong">{{ terrainKey() | transloco }}</b>
  `,
  styles: `
    :host {
      background: color-mix(in oklab, var(--color-surface) 86%, transparent);
    }
  `,
})
export class CoordReadout {
  readonly coord = input<Axial | null>(null);
  readonly terrainKey = input.required<string>();
}
