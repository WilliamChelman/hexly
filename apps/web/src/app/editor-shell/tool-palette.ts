import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { featureLibrary, terrainPalette } from '@hexly/domain';
import { Button } from '../ui/button';
import { Eyebrow } from '../ui/eyebrow';
import { Input } from '../ui/input';
import { Panel } from '../ui/panel';
import { Rule } from '../ui/rule';
import { Tool as ToolButton, ToolGlyph } from '../ui/tool';
import { EditorStore, Tool } from './editor-store';

/** A content tool — not yet wired to the canvas; shown as a preview for now. */
interface ContentTool {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly glyph: ToolGlyph;
}

/**
 * The colours a freshly-created region cycles through, so two new regions look
 * distinct without the user having to pick a colour first. They can recolour to
 * anything afterwards — the document stores an arbitrary `#rrggbb` (issue #8).
 */
const NEW_REGION_COLORS = ['#7c9b86', '#b08a4e', '#6f7fae', '#a8674f', '#5f8c8c'];

/** The two region brush modes, rendered as a Paint/Erase button pair per region. */
const REGION_MODES = [
  { mode: 'add', label: 'Paint', verb: 'Paint into', testid: 'paint' },
  { mode: 'remove', label: 'Erase', verb: 'Erase from', testid: 'erase' },
] as const;

/**
 * The left rail: the terrain palette and the eraser (the armed tool lives in the
 * shared {@link EditorStore} so the canvas paints with it — ADR-0005), plus undo/
 * redo and the region legend. Content tools are previews until their own issues
 * land.
 */
@Component({
  selector: 'app-tool-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Eyebrow, Input, Panel, Rule, ToolButton],
  template: `
    <section class="group">
      <h2 class="heading" appEyebrow>Terrain</h2>
      <div class="list" role="group" aria-label="Terrain">
        @let terrainState = store.tool();
        @for (t of terrainTools; track t.id) {
          <button
            appTool
            [label]="t.label"
            [hint]="t.hint"
            [swatch]="t.swatch"
            [active]="terrainState.kind === 'terrain' && terrainState.id === t.id"
            [attr.aria-label]="t.label"
            (click)="store.selectTool({ kind: 'terrain', id: t.id })"
          ></button>
        }
        <button
          appTool
          label="Erase"
          hint="E"
          [active]="terrainState.kind === 'erase'"
          aria-label="Erase"
          (click)="store.selectTool({ kind: 'erase' })"
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
      <h2 class="heading" appEyebrow>Features</h2>
      <div class="list" role="group" aria-label="Features">
        @let featureState = store.tool();
        @for (f of features; track f.id) {
          <button
            appTool
            [label]="f.label"
            [iconPath]="f.path"
            [active]="featureState.kind === 'feature' && featureState.id === f.id"
            [attr.aria-label]="f.label"
            [attr.data-testid]="'feature-' + f.id"
            (click)="store.selectTool({ kind: 'feature', id: f.id })"
          ></button>
        }
        <button
          appTool
          label="Clear feature"
          [active]="featureState.kind === 'clear-feature'"
          aria-label="Clear feature"
          data-testid="clear-feature"
          (click)="store.selectTool({ kind: 'clear-feature' })"
        ></button>
      </div>
    </section>

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
      @let armed = store.tool();
      <ul class="legend">
        @for (r of store.document().regions; track r.id) {
          <li>
            <input
              type="color"
              class="color"
              [value]="r.color"
              [attr.aria-label]="r.name + ' color'"
              [attr.data-testid]="'region-color-' + r.id"
              (change)="recolor(r.id, $event)"
            />
            <!--
              One-way [value] with (change): an OnPush re-render mid-edit could
              re-apply the bound name, but any in-app action that re-renders also
              blurs (and thus commits) this field, so that race is unreachable.
            -->
            <input
              appInput
              class="rname"
              [value]="r.name"
              [attr.aria-label]="r.name + ' name'"
              [attr.data-testid]="'region-name-' + r.id"
              (change)="rename(r.id, $event)"
            />
            @for (b of regionModes; track b.mode) {
              <button
                type="button"
                class="mode"
                [class.active]="isArmed(armed, r.id, b.mode)"
                [attr.aria-label]="b.verb + ' ' + r.name"
                [attr.aria-pressed]="isArmed(armed, r.id, b.mode)"
                [attr.data-testid]="'region-' + b.testid + '-' + r.id"
                (click)="store.selectTool({ kind: 'region', id: r.id, mode: b.mode })"
              >
                {{ b.label }}
              </button>
            }
            <button
              type="button"
              class="remove"
              [attr.aria-label]="'Delete ' + r.name"
              [attr.data-testid]="'region-delete-' + r.id"
              (click)="store.deleteRegion(r.id)"
            >
              ×
            </button>
          </li>
        } @empty {
          <li class="muted">No regions yet.</li>
        }
      </ul>
      <button
        type="button"
        appButton
        variant="ghost"
        size="sm"
        data-testid="new-region"
        (click)="createRegion()"
      >
        New region
      </button>
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
      margin: 0;
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
    .legend .muted {
      color: var(--ink-muted);
      font-style: italic;
    }
    .color {
      flex: none;
      width: 18px;
      height: 18px;
      padding: 0;
      border: 1px solid var(--line-strong);
      border-radius: var(--radius-sm);
      background: none;
      cursor: pointer;
    }
    .rname {
      /* Layout only — field styling comes from appInput. */
      flex: 1;
      min-width: 0;
    }
    .mode {
      flex: none;
      background: none;
      color: var(--ink-muted);
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      padding: 2px var(--space-2);
      font-size: var(--text-xs);
      cursor: pointer;
    }
    .mode.active {
      color: var(--ink);
      border-color: var(--gold);
      background: var(--gold-soft);
    }
    .remove {
      flex: none;
      background: none;
      border: none;
      color: var(--ink-muted);
      cursor: pointer;
      font-size: var(--text-md);
      line-height: 1;
      padding: 0 var(--space-1);
    }
    .remove:hover {
      color: var(--ember);
    }
  `,
})
export class ToolPalette {
  protected readonly store = inject(EditorStore);

  /** The built-in feature library, each placeable from the palette (issue #7). */
  protected readonly features = featureLibrary;

  /** The built-in terrain palette, with a 1-based number key per entry. */
  protected readonly terrainTools = terrainPalette.map((t, i) => ({
    id: t.id,
    label: t.label,
    swatch: t.fill,
    hint: String(i + 1),
  }));

  protected readonly contentTools: ContentTool[] = [
    { id: 'overlay', label: 'Overlay', hint: 'O', glyph: 'overlay' },
    { id: 'label', label: 'Label', hint: 'L', glyph: 'label' },
  ];

  protected readonly regionModes = REGION_MODES;

  /**
   * Create a region with a default name and a cycling colour, then arm it for
   * painting. The default number is the next unused "Region N" (max existing + 1,
   * or 1 when none) rather than the region count, so a name/colour freed by a
   * deletion isn't immediately reused.
   */
  protected createRegion(): void {
    const used = this.store.document().regions.flatMap((r) => {
      const match = /^Region (\d+)$/.exec(r.name);
      return match ? [Number(match[1])] : [];
    });
    const n = used.length ? Math.max(...used) + 1 : 1;
    const color = NEW_REGION_COLORS[(n - 1) % NEW_REGION_COLORS.length];
    const id = this.store.createRegion(`Region ${n}`, color);
    this.store.selectTool({ kind: 'region', id, mode: 'add' });
  }

  /** Rename region `id` to the text input's value. */
  protected rename(id: string, event: Event): void {
    this.store.renameRegion(id, (event.target as HTMLInputElement).value);
  }

  /** Recolour region `id` to the colour input's value. */
  protected recolor(id: string, event: Event): void {
    this.store.recolorRegion(id, (event.target as HTMLInputElement).value);
  }

  /** Whether `tool` is the region brush armed for region `id` in `mode`. */
  protected isArmed(tool: Tool, id: string, mode: 'add' | 'remove'): boolean {
    return tool.kind === 'region' && tool.id === id && tool.mode === mode;
  }
}
