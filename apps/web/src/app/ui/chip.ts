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
    :host {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-1) var(--spacing-3);
      font-size: var(--text-2xs);
      font-weight: var(--font-weight-semibold);
      letter-spacing: var(--tracking-wide);
      text-transform: uppercase;
      color: var(--color-ink-muted);
      background: var(--color-surface-sunken);
      border: 1px solid var(--color-line);
      border-radius: var(--radius-full);
    }
    :host(.is-gold) {
      color: var(--color-gold-strong);
      background: var(--color-gold-soft);
      border-color: color-mix(in oklab, var(--color-gold) 36%, transparent);
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
