import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Axial } from '@hexly/domain';

/**
 * The map's hover readout — a single frosted mono pill showing the hovered
 * coordinate and the terrain (or state) under the cursor, with the q/r values
 * and terrain illuminated in gold (codex `.coord`). Purely presentational, like
 * {@link ZoomControl}: it renders the {@link coord} and {@link terrainKey} it's
 * handed; the canvas owns the hover state (ADR-0003) and the parent places it.
 * Owns its own chrome (ADR-0007). Inert to the pointer so it never intercepts a
 * canvas gesture.
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
    q <b class="font-semibold text-gold-strong">{{ coord()?.q ?? 0 }}</b>
    · r <b class="font-semibold text-gold-strong">{{ coord()?.r ?? 0 }}</b>
    · <b class="font-semibold text-gold-strong">{{ terrainKey() | transloco }}</b>
  `,
  styles: `
    /* Frosted surface kept scoped: a color-mix() over a theme token re-themes
       where the 'bg-surface/NN' modifier's baked fallback would not (ADR-0021). */
    :host {
      background: color-mix(in oklab, var(--color-surface) 86%, transparent);
    }
  `,
})
export class CoordReadout {
  /** The hex under the cursor, or null when the cursor is off the canvas. */
  readonly coord = input<Axial | null>(null);
  /** The i18n key for the terrain (or Void/no-hex state) under the cursor. */
  readonly terrainKey = input.required<string>();
}
