import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  input,
} from '@angular/core';
import { Icon, IconName } from './icon/icon';
import { Kbd } from './kbd';
import { Swatch } from './swatch';

/**
 * A palette tool button — square-ish, full-width, with a leading swatch or
 * glyph, a label, and an optional keycap hint. It renders its own internal
 * structure from inputs so its scoped styles reach its parts. Uses an attribute
 * selector on the native `<button>`, so it keeps focus/type/a11y. See ADR-0007.
 *
 *   <button appTool [label]="t.label" [hint]="t.hint" [swatch]="t.swatch"
 *           [glyph]="t.glyph" [active]="activeTool() === t.id"
 *           (click)="setTool(t.id)"></button>
 */
@Component({
  selector: 'button[appTool]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Swatch, Kbd],
  host: {
    '[class.is-active]': 'active()',
    '[attr.aria-pressed]': 'active()',
    '[attr.type]': '"button"',
  },
  template: `
    @if (swatch()) {
      <span appSwatch [style.background]="'var(' + swatch() + ')'"></span>
    } @else if (glyph()) {
      <span class="glyph"><app-icon [name]="glyph()!" [size]="18" /></span>
    }
    <span class="label">{{ label() }}</span>
    @if (hint()) {
      <kbd appKbd>{{ hint() }}</kbd>
    }
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      width: 100%;
      padding: var(--space-2) var(--space-3);
      font-size: var(--text-sm);
      color: var(--ink);
      background: transparent;
      border: 1px solid transparent;
      border-radius: var(--radius-md);
      cursor: pointer;
      text-align: left;
      transition:
        background-color var(--dur-fast) var(--ease-out),
        border-color var(--dur-fast) var(--ease-out),
        color var(--dur-fast) var(--ease-out);
    }
    :host(:hover) {
      background: var(--gold-soft);
    }
    :host(.is-active) {
      background: var(--gold-soft);
      border-color: var(--gold);
      color: var(--ink-strong);
    }
    .glyph {
      display: grid;
      place-items: center;
      width: 30px;
      height: 30px;
      flex: none;
      border-radius: var(--radius-sm);
      background: var(--surface-sunken);
      border: 1px solid var(--line);
      color: var(--ink-muted);
    }
    :host(.is-active) .glyph {
      color: var(--gold);
      border-color: var(--gold);
    }
    .label {
      flex: 1;
      font-weight: var(--weight-medium);
    }
  `,
})
export class Tool {
  readonly label = input.required<string>();
  readonly hint = input<string>();
  /** A `--terrain-*` colour token; renders a leading swatch. */
  readonly swatch = input<string>();
  /** An icon glyph; renders a leading glyph box (used when no swatch). */
  readonly glyph = input<IconName>();
  readonly active = input(false, { transform: booleanAttribute });
}
