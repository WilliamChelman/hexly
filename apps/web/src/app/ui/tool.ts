import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  input,
} from '@angular/core';
import { GlyphBox } from './glyph-box';
import { IconPath } from './icon/icon-path';
import { EraseIcon } from './icon/glyphs/erase';
import { LabelIcon } from './icon/glyphs/label';
import { OverlayIcon } from './icon/glyphs/overlay';
import { RegionIcon } from './icon/glyphs/region';
import { SelectIcon } from './icon/glyphs/select';
import { SettlementIcon } from './icon/glyphs/settlement';
import { TerrainIcon } from './icon/glyphs/terrain';
import { Kbd } from './kbd';
import { Swatch } from './swatch';

/**
 * The glyphs a palette tool can show (terrain Subtools use a swatch instead).
 * The six top-level Tools each have one; `overlay` remains for a future Tool.
 */
export type ToolGlyph =
  | 'select'
  | 'terrain'
  | 'feature'
  | 'region'
  | 'label'
  | 'erase'
  | 'overlay';

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
  imports: [
    GlyphBox,
    IconPath,
    SelectIcon,
    TerrainIcon,
    SettlementIcon,
    RegionIcon,
    LabelIcon,
    EraseIcon,
    OverlayIcon,
    Swatch,
    Kbd,
  ],
  host: {
    '[class.is-active]': 'active()',
    '[attr.aria-pressed]': 'active()',
    '[attr.type]': '"button"',
  },
  template: `
    @if (swatch()) {
      <span appSwatch [style.background]="'var(' + swatch() + ')'"></span>
    } @else if (iconPath(); as d) {
      <span appGlyphBox><app-icon-path [d]="d" /></span>
    } @else if (glyph(); as g) {
      <span appGlyphBox>
        @switch (g) {
          @case ('select') { <app-icon-select [size]="18" /> }
          @case ('terrain') { <app-icon-terrain [size]="18" /> }
          @case ('feature') { <app-icon-settlement [size]="18" /> }
          @case ('region') { <app-icon-region [size]="18" /> }
          @case ('label') { <app-icon-label [size]="18" /> }
          @case ('erase') { <app-icon-erase [size]="18" /> }
          @case ('overlay') { <app-icon-overlay [size]="18" /> }
        }
      </span>
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
    :host(.is-active) [appGlyphBox] {
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
  /** A content glyph; renders a leading glyph box (used when no swatch). */
  readonly glyph = input<ToolGlyph>();
  /** An SVG path (`d`) for a library icon; renders in the glyph box by path. */
  readonly iconPath = input<string>();
  readonly active = input(false, { transform: booleanAttribute });
}
