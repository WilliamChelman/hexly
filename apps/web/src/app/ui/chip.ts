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
      gap: var(--space-2);
      padding: var(--space-1) var(--space-3);
      font-size: var(--text-2xs);
      font-weight: var(--weight-semibold);
      letter-spacing: var(--tracking-wide);
      text-transform: uppercase;
      color: var(--ink-muted);
      background: var(--surface-sunken);
      border: 1px solid var(--line);
      border-radius: var(--radius-full);
    }
    :host(.is-gold) {
      color: var(--gold-strong);
      background: var(--gold-soft);
      border-color: color-mix(in oklab, var(--gold) 36%, transparent);
    }
    :host(.is-sea) {
      color: var(--sea);
      background: var(--sea-soft);
      border-color: color-mix(in oklab, var(--sea) 36%, transparent);
    }
    :host(.is-astra) {
      color: var(--astra);
      background: var(--astra-soft);
      border-color: color-mix(in oklab, var(--astra) 36%, transparent);
    }
  `,
})
export class Chip {
  readonly tone = input<ChipTone>();
}
