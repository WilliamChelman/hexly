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
    /* Display-face small-caps badge, widely tracked. */
    :host {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: 3px 11px;
      font-family: var(--font-display);
      font-size: var(--text-2xs);
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: var(--color-ink-muted);
      background: var(--color-surface-sunken);
      border: 1px solid var(--color-line-strong);
      border-radius: var(--radius-full);
    }
    :host(.is-gold) {
      color: var(--color-gold);
      background: color-mix(in oklab, var(--color-gold) 12%, transparent);
      border-color: var(--color-line-strong);
    }
    :host(.is-sea) {
      color: var(--color-sea);
      background: var(--color-sea-soft);
      border-color: color-mix(in oklab, var(--color-sea) 36%, transparent);
    }
    :host(.is-astra) {
      color: var(--color-astra);
      background: var(--color-astra-soft);
      border-color: color-mix(in oklab, var(--color-astra) 36%, transparent);
    }
  `,
})
export class Chip {
  readonly tone = input<ChipTone>();
}
