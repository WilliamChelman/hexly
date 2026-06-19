import { Directive, booleanAttribute, input } from '@angular/core';

/**
 * Turns a semantic container (`<section>`, `<figure>`, `<aside>`…) into a Hexly
 * panel by applying the token-driven `.panel` classes. It is a directive, not a
 * wrapper component, so the real element keeps its semantics and composes freely
 * with layout classes — and so the visual definition can stay in the global
 * token layer (a directive owns no styles). See ADR-0007.
 *
 *   <section class="group regions" appPanel raised>…</section>
 *   <figure class="typelist" appPanel>…</figure>
 */
@Directive({
  selector: '[appPanel]',
  host: {
    class: 'panel',
    '[class.panel--raised]': 'raised()',
    '[class.panel--flush]': 'flush()',
  },
})
export class PanelDirective {
  /** A lifted surface with a stronger shadow. */
  readonly raised = input(false, { transform: booleanAttribute });
  /** Square corners, for a panel that meets an edge. */
  readonly flush = input(false, { transform: booleanAttribute });
}
