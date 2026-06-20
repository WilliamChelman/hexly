import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  input,
} from '@angular/core';

/**
 * Turns a semantic container (`<section>`, `<figure>`, `<aside>`…) into a Hexly
 * panel via its own scoped, token-driven styles. It uses an attribute selector
 * on the native element, so the real element keeps its semantics and composes
 * freely with layout classes — and `<ng-content/>` projects its children — while
 * the component owns its visual definition. See ADR-0007.
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
    :host {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-1);
    }
    :host(.is-raised) {
      background: var(--surface-raised);
      box-shadow: var(--shadow-2);
    }
    :host(.is-flush) {
      border-radius: 0;
    }
  `,
})
export class Panel {
  /** A lifted surface with a stronger shadow. */
  readonly raised = input(false, { transform: booleanAttribute });
  /** Square corners, for a panel that meets an edge. */
  readonly flush = input(false, { transform: booleanAttribute });
}
