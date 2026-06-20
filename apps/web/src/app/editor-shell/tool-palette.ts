import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { terrainPalette } from '@hexly/domain';
import { Button } from '../ui/button';
import { Eyebrow } from '../ui/eyebrow';
import { Panel } from '../ui/panel';
import { Rule } from '../ui/rule';
import { Swatch } from '../ui/swatch';
import { Tool as ToolButton, ToolGlyph } from '../ui/tool';
import { EditorStore, ERASER } from './editor-store';

/** A content tool — not yet wired to the canvas; shown as a preview for now. */
interface ContentTool {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly glyph: ToolGlyph;
}

/**
 * The left rail: the terrain palette and the eraser (the armed tool lives in the
 * shared {@link EditorStore} so the canvas paints with it — ADR-0005), plus undo/
 * redo and the region legend. Content tools are previews until their own issues
 * land.
 */
@Component({
  selector: 'app-tool-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Eyebrow, Panel, Rule, Swatch, ToolButton],
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
            [active]="store.tool() === t.id"
            [attr.aria-label]="t.label"
            (click)="store.selectTool(t.id)"
          ></button>
        }
        <button
          appTool
          label="Erase"
          hint="E"
          [active]="store.tool() === eraser"
          aria-label="Erase"
          (click)="store.selectTool(eraser)"
        ></button>
      </div>
    </section>

    <hr appRule />

    <section class="group">
      <h2 class="heading" appEyebrow>History</h2>
      <div class="history">
        <button
          type="button"
          appButton
          variant="ghost"
          size="sm"
          [disabled]="!store.canUndo()"
          (click)="store.undo()"
        >
          Undo
        </button>
        <button
          type="button"
          appButton
          variant="ghost"
          size="sm"
          [disabled]="!store.canRedo()"
          (click)="store.redo()"
        >
          Redo
        </button>
      </div>
    </section>

    <hr appRule />

    <section class="group">
      <h2 class="heading" appEyebrow>Content</h2>
      <div class="list" role="group" aria-label="Content">
        @for (t of contentTools; track t.id) {
          <button
            appTool
            disabled
            [label]="t.label"
            [hint]="t.hint"
            [glyph]="t.glyph"
            [attr.aria-label]="t.label + ' (coming soon)'"
            title="Coming soon"
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
    .history {
      display: flex;
      gap: var(--space-2);
    }
    .history button {
      flex: 1;
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
  protected readonly store = inject(EditorStore);
  protected readonly eraser = ERASER;

  /** The built-in terrain palette, with a 1-based number key per entry. */
  protected readonly terrainTools = terrainPalette.map((t, i) => ({
    id: t.id,
    label: t.label,
    swatch: t.fill,
    hint: String(i + 1),
  }));

  protected readonly contentTools: ContentTool[] = [
    { id: 'feature', label: 'Feature', hint: 'F', glyph: 'feature' },
    { id: 'overlay', label: 'Overlay', hint: 'O', glyph: 'overlay' },
    { id: 'region', label: 'Region', hint: 'R', glyph: 'region' },
    { id: 'label', label: 'Label', hint: 'L', glyph: 'label' },
  ];
}
