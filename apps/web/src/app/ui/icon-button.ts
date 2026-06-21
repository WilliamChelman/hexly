import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  input,
} from '@angular/core';
import { IconPath } from './icon/icon-path';
import { EraseIcon } from './icon/glyphs/erase';
import { LabelIcon } from './icon/glyphs/label';
import { MinusIcon } from './icon/glyphs/minus';
import { RedoIcon } from './icon/glyphs/redo';
import { RegionIcon } from './icon/glyphs/region';
import { SelectIcon } from './icon/glyphs/select';
import { SettlementIcon } from './icon/glyphs/settlement';
import { TerrainIcon } from './icon/glyphs/terrain';
import { UndoIcon } from './icon/glyphs/undo';
import { Swatch } from './swatch';

/**
 * The named glyphs an {@link IconButton} can show: one per top-level Tool, plus
 * `minus` (the Clear-feature mark) and `undo`/`redo` for the history controls,
 * since the floating tool strip renders those as icon buttons too (ADR-0013).
 */
export type IconButtonGlyph =
  | 'select'
  | 'terrain'
  | 'feature'
  | 'region'
  | 'label'
  | 'erase'
  | 'minus'
  | 'undo'
  | 'redo';

/**
 * A square, icon-only button — the shared primitive behind the floating tool
 * strip, its Subtool flyout, and the right-edge rail (ADR-0013, ADR-0007). It
 * shows exactly one leading mark: a colour `swatch` (terrain Subtools), a library
 * `iconPath` (feature Subtools), or a named `glyph` (Tools and undo/redo). It
 * carries no inline label — the caller supplies a `title` tooltip (`Terrain (T)`)
 * and an `aria-label` for discoverability, reusing the edge rail's existing
 * pattern. Uses an attribute selector on the native `<button>`, so `disabled`,
 * `type`, and focus/a11y come for free.
 *
 * A button that represents an on/off or selected state opts into toggle
 * semantics with `toggle`, which emits `aria-pressed` from `active`. Momentary
 * action buttons (undo/redo) leave it off so they aren't announced as toggles.
 *
 *   <button appIconButton glyph="terrain" toggle [active]="armed()"
 *           title="Terrain (T)" aria-label="Terrain" (click)="arm()"></button>
 */
@Component({
  selector: 'button[appIconButton]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IconPath,
    SelectIcon,
    TerrainIcon,
    SettlementIcon,
    RegionIcon,
    LabelIcon,
    EraseIcon,
    MinusIcon,
    UndoIcon,
    RedoIcon,
    Swatch,
  ],
  host: {
    '[class.is-active]': 'active()',
    '[attr.aria-pressed]': 'toggle() ? active() : null',
    '[attr.type]': '"button"',
  },
  template: `
    @if (swatch()) {
      <span appSwatch [style.background]="'var(' + swatch() + ')'"></span>
    } @else if (iconPath(); as d) {
      <app-icon-path [d]="d" [size]="20" />
    } @else if (glyph(); as g) {
      @switch (g) {
        @case ('select') { <app-icon-select [size]="20" /> }
        @case ('terrain') { <app-icon-terrain [size]="20" /> }
        @case ('feature') { <app-icon-settlement [size]="20" /> }
        @case ('region') { <app-icon-region [size]="20" /> }
        @case ('label') { <app-icon-label [size]="20" /> }
        @case ('erase') { <app-icon-erase [size]="20" /> }
        @case ('minus') { <app-icon-minus [size]="20" /> }
        @case ('undo') { <app-icon-undo [size]="20" /> }
        @case ('redo') { <app-icon-redo [size]="20" /> }
      }
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: var(--space-7);
      height: var(--space-7);
      color: var(--ink-muted);
      background: transparent;
      border: 1px solid transparent;
      border-radius: var(--radius-md);
      cursor: pointer;
      transition:
        background-color var(--dur-fast) var(--ease-out),
        border-color var(--dur-fast) var(--ease-out),
        color var(--dur-fast) var(--ease-out);
    }
    :host(:hover:not(:disabled)) {
      color: var(--ink);
      background: var(--gold-soft);
    }
    :host(.is-active) {
      color: var(--gold);
      background: var(--gold-soft);
      border-color: var(--gold);
    }
    :host(:disabled) {
      opacity: 0.4;
      cursor: not-allowed;
    }
  `,
})
export class IconButton {
  /** A `--terrain-*` colour token; renders a leading swatch chip. */
  readonly swatch = input<string>();
  /** An SVG path (`d`) for a library icon (a feature); rendered directly. */
  readonly iconPath = input<string>();
  /** A named content glyph (a Tool, or undo/redo); rendered directly. */
  readonly glyph = input<IconButtonGlyph>();
  /** The selected/armed highlight; also feeds `aria-pressed` when `toggle` is set. */
  readonly active = input(false, { transform: booleanAttribute });
  /**
   * Marks this button as a toggle so it exposes `aria-pressed` (from `active`).
   * Off by default: a momentary action (undo/redo) must not read as a toggle.
   */
  readonly toggle = input(false, { transform: booleanAttribute });
}
