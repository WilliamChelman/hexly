import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Colour family of a chip — undefined is the neutral chip. */
export type ChipTone = 'gold' | 'sea' | 'astra';

/**
 * A chip / badge — its own decorative span, so it owns its styles rather than
 * borrowing a global `.chip` class. Projects its content (which may include a
 * nested swatch). `tone` selects a colour family; omit it for the neutral chip.
 * See ADR-0007.
 *
 *   <app-chip>Default</app-chip>
 *   <app-chip tone="gold">Settlement</app-chip>
 */
@Component({
  selector: 'app-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.is-gold]': "tone() === 'gold'",
    '[class.is-sea]': "tone() === 'sea'",
    '[class.is-astra]': "tone() === 'astra'",
  },
  template: `<ng-content />`,
  styles: `
    @reference '../../styles.css';

    /* Display-face small-caps badge, widely tracked. Base fully converts —
       off-scale padding (3/11px) rides arbitrary utilities. */
    :host {
      @apply inline-flex items-center gap-2 py-[3px] px-[11px] font-display
        text-2xs tracking-[0.22em] uppercase text-ink-muted bg-surface-sunken
        border border-line-strong rounded-full;
    }
    /* Tone variants: token color/bg convert; only color-mix stays raw (ADR-0021). */
    :host(.is-gold) {
      @apply text-gold border-line-strong;
      background: color-mix(in oklab, var(--color-gold) 12%, transparent);
    }
    :host(.is-sea) {
      @apply text-sea bg-sea-soft;
      border-color: color-mix(in oklab, var(--color-sea) 36%, transparent);
    }
    :host(.is-astra) {
      @apply text-astra bg-astra-soft;
      border-color: color-mix(in oklab, var(--color-astra) 36%, transparent);
    }
  `,
})
export class Chip {
  readonly tone = input<ChipTone>();
}
