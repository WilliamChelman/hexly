import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { IconButtonComponent, IconComponent, IconPathComponent, PanelComponent, RuleComponent } from '@hexly/web-ui';
import { BoardStore } from '../services/board-store';
import { TOOLS } from './tools';

/**
 * The Board's floating tool palette (ADR-0013): an icon strip of the top-level Tools plus the undo/redo
 * history controls. Exactly one Tool reads as armed at a time, driven off {@link BoardStore.tool}; a
 * Board opens armed with Select (CONTEXT.md → Tool, #267). The minimal Box places the minimal static
 * element; the Text Block (#268) and Image (#269) Tools slot into {@link TOOLS} later.
 *
 * No Subtool flyout yet — the Board's Tools carry no Subtools at Seam B, unlike the Hex Map's palette.
 */
@Component({
  selector: 'app-board-tool-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex items-start gap-2' },
  imports: [IconButtonComponent, IconComponent, IconPathComponent, PanelComponent, RuleComponent, TranslocoPipe],
  template: `
    <div
      class="flex flex-col gap-2 p-2 min-h-0 max-h-full overflow-y-auto"
      appPanel
      role="group"
      [attr.aria-label]="'board.toolPalette.tools' | transloco"
    >
      @for (t of tools; track t.id) {
        @let toolName = 'board.toolPalette.' + t.id | transloco;
        <button
          appIconButton
          toggle
          [active]="store.tool() === t.id"
          [title]="toolName + ' (' + t.key + ')'"
          [attr.aria-label]="toolName"
          [attr.data-testid]="'tool-' + t.id"
          (click)="store.armTool(t.id)"
        >
          @if (t.icon; as icon) {
            <app-icon [name]="icon" [size]="20" />
          } @else if (t.path; as path) {
            <app-icon-path [d]="path" [size]="20" />
          }
        </button>
      }

      <hr appRule class="w-full" />

      <button
        appIconButton
        [title]="'board.toolPalette.undo' | transloco"
        [attr.aria-label]="'board.toolPalette.undo' | transloco"
        data-testid="undo"
        [disabled]="!store.canUndo()"
        (click)="store.undo()"
      >
        <app-icon name="undo" [size]="20" />
      </button>
      <button
        appIconButton
        [title]="'board.toolPalette.redo' | transloco"
        [attr.aria-label]="'board.toolPalette.redo' | transloco"
        data-testid="redo"
        [disabled]="!store.canRedo()"
        (click)="store.redo()"
      >
        <app-icon name="redo" [size]="20" />
      </button>
    </div>
  `,
})
export class ToolPaletteComponent {
  protected readonly store = inject(BoardStore);

  // Keycap is the hotkey upper-cased for display. The glyph is flattened to its two cases — a built-in
  // icon, or this lib's own path art — because a template cannot narrow a union.
  protected readonly tools = TOOLS.map((t) => ({
    id: t.id,
    icon: 'icon' in t.glyph ? t.glyph.icon : undefined,
    path: 'path' in t.glyph ? t.glyph.path : undefined,
    key: t.hotkey.toUpperCase(),
  }));
}
