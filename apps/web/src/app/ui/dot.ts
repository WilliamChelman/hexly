import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  input,
} from '@angular/core';

/**
 * A small status dot. `positive` turns it into a healthy/lit dot with a soft
 * halo. See ADR-0007.
 *
 *   <span appDot [positive]="healthy()"></span>
 */
@Component({
  selector: '[appDot]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.is-positive]': 'positive()',
  },
  template: '',
  styles: `
    @reference '../../styles.css';

    :host {
      @apply w-2 h-2 rounded-full bg-ink-faint flex-none;
    }
    :host(.is-positive) {
      @apply bg-positive;
      /* literal-geometry halo (not a token shadow) — stays raw. */
      box-shadow: 0 0 0 3px var(--color-positive-soft);
    }
  `,
})
export class Dot {
  /** A healthy/lit dot — green with a soft halo. */
  readonly positive = input(false, { transform: booleanAttribute });
}
