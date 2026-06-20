import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { IconName } from '../ui/icon/icon';
import { Eyebrow } from '../ui/eyebrow';
import { Panel } from '../ui/panel';
import { Rule } from '../ui/rule';
import { Swatch } from '../ui/swatch';
import { Tool as ToolButton } from '../ui/tool';

/** A palette entry — one paintable thing, named in the domain's vocabulary. */
interface Tool {
  readonly id: string;
  readonly label: string;
  readonly hint: string; // keyboard shortcut
  /** A terrain swatch colour token, when this tool paints a Terrain. */
  readonly swatch?: string;
  /** An icon glyph, for non-terrain tools. */
  readonly glyph?: IconName;
}

/**
 * The left rail: terrain and content tools, plus the region legend. It owns the
 * armed-tool selection for now — the canvas is a frozen placeholder (ADR-0003),
 * so nothing else needs it yet; once painting is wired (ADR-0005) this graduates
 * to a shared editor-state service.
 */
@Component({
  selector: 'app-tool-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Eyebrow, Panel, Rule, Swatch, ToolButton],
  template: `
    <section class="group">
      <h2 class="heading" appEyebrow>Terrain</h2>
      <div class="list" role="group" aria-label="Terrain">
        @for (t of terrainTools; track t.id) {
          <button
            appTool
            [label]="t.label"
            [hint]="t.hint"
            [swatch]="t.swatch"
            [active]="activeTool() === t.id"
            [attr.aria-label]="t.label"
            (click)="setTool(t.id)"
          ></button>
        }
      </div>
    </section>

    <hr appRule />

    <section class="group">
      <h2 class="heading" appEyebrow>Content</h2>
      <div class="list" role="group" aria-label="Content">
        @for (t of contentTools; track t.id) {
          <button
            appTool
            [label]="t.label"
            [hint]="t.hint"
            [glyph]="t.glyph"
            [active]="activeTool() === t.id"
            [attr.aria-label]="t.label"
            (click)="setTool(t.id)"
          ></button>
        }
      </div>
    </section>

    <div class="spacer"></div>

    <section class="group regions" appPanel raised>
      <h2 appEyebrow>Regions</h2>
      <ul class="legend">
        <li><span appSwatch style="background: #7c9b86"></span>The Whisperwood</li>
        <li><span appSwatch style="background: #b08a4e"></span>Aldermoor Reach</li>
        <li><span appSwatch style="background: #6f7fae"></span>The Drowned Coast</li>
      </ul>
    </section>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      padding: var(--space-4);
      overflow-y: auto;
      background: var(--bg-deep);
      border-right: 1px solid var(--line-strong);
    }
    .group {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }
    .heading {
      padding: 0 var(--space-2);
    }
    .list {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .spacer {
      flex: 1;
    }
    .regions {
      gap: var(--space-3);
      padding: var(--space-3) var(--space-4);
    }
    .legend {
      list-style: none;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      font-size: var(--text-sm);
      color: var(--ink-muted);
    }
    .legend li {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
  `,
})
export class ToolPalette {
  /** Which palette tool is currently armed. */
  protected readonly activeTool = signal('forest');

  protected readonly terrainTools: Tool[] = [
    { id: 'grass', label: 'Grassland', hint: '1', swatch: '--terrain-grass' },
    { id: 'forest', label: 'Forest', hint: '2', swatch: '--terrain-forest' },
    { id: 'ocean', label: 'Ocean', hint: '3', swatch: '--terrain-ocean' },
    { id: 'mountain', label: 'Mountains', hint: '4', swatch: '--terrain-mountain' },
    { id: 'desert', label: 'Desert', hint: '5', swatch: '--terrain-desert' },
  ];

  protected readonly contentTools: Tool[] = [
    { id: 'feature', label: 'Feature', hint: 'F', glyph: 'feature' },
    { id: 'overlay', label: 'Overlay', hint: 'O', glyph: 'overlay' },
    { id: 'region', label: 'Region', hint: 'R', glyph: 'region' },
    { id: 'label', label: 'Label', hint: 'L', glyph: 'label' },
  ];

  setTool(id: string): void {
    this.activeTool.set(id);
  }
}
