import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  input,
} from '@angular/core';

/**
 * A small uppercase section eyebrow/label. Uses an attribute selector so it
 * keeps its host element (`<span>`, `<h2>`, `<figcaption>`…). Projects its
 * content. `mark` prefixes the gilded codex section glyph (✦) — opt-in, since
 * the header/library eyebrows wear no mark. See ADR-0007.
 *
 *   <span appEyebrow>Hex map</span>
 *   <h2 appEyebrow mark>Terrain</h2>
 */
@Component({
  selector: '[appEyebrow]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'font-display text-2xs font-semibold tracking-wider uppercase text-ink-muted',
    '[class.is-marked]': 'mark()',
  },
  template: '<ng-content />',
  styles: `
    :host(.is-marked)::before {
      content: '✦';
      margin-right: 0.5em;
      color: var(--color-gold);
      font-size: 0.85em;
      opacity: 0.7;
    }
  `,
})
export class Eyebrow {
  /** Prefix the gilded ✦ section mark (codex right-rail/panel eyebrows). */
  readonly mark = input(false, { transform: booleanAttribute });
}
