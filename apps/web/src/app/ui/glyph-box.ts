import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * A small bordered tile that frames a single glyph — the leading icon box shared
 * by palette tools and the inspector's selection header. Uses an attribute
 * selector so it keeps its host element, and projects its content (a glyph
 * component). Callers may recolour it from the outside (e.g. a tool's active
 * state restyles `[appGlyphBox]`). See ADR-0007.
 *
 *   <span appGlyphBox><app-icon-settlement [size]="18" /></span>
 */
@Component({
  selector: '[appGlyphBox]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
  styles: `
    :host {
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
  `,
})
export class GlyphBox {}
