import { ChangeDetectionStrategy, Component, booleanAttribute, input } from '@angular/core';

/**
 * Turns a semantic container (`<section>`, `<figure>`, `<aside>`…) into a Hexly
 * panel. Attribute selector on the native element, so the host keeps its own
 * semantics and layout classes. See ADR-0007.
 *
 *   <section class="group regions" appPanel raised>…</section>
 *   <figure class="typelist" appPanel>…</figure>
 */
@Component({
  selector: '[appPanel]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.is-raised]': 'raised()',
    '[class.is-flush]': 'flush()',
  },
  template: `<ng-content />`,
  styles: `
    @reference '#app-styles.css';

    :host {
      @apply bg-surface border border-line rounded-lg shadow-1;
    }
    :host(.is-raised) {
      @apply bg-surface-raised shadow-2;
    }
    :host(.is-flush) {
      @apply rounded-none;
    }
  `,
})
export class PanelComponent {
  /** A lifted surface with a stronger shadow. */
  readonly raised = input(false, { transform: booleanAttribute });
  /** Square corners, for a panel that meets an edge. */
  readonly flush = input(false, { transform: booleanAttribute });
}
