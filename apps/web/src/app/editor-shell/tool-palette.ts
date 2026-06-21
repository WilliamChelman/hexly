import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { featureLibrary, terrainPalette } from '@hexly/domain';
import { Button } from '../ui/button';
import { Eyebrow } from '../ui/eyebrow';
import { Rule } from '../ui/rule';
import { Tool as ToolButton, ToolGlyph } from '../ui/tool';
import { EditorStore, featureSubtools, ToolId } from './editor-store';

/**
 * The one-line hint shown for a Tool that has no Subtool strip (issue #27). Keyed
 * by the no-Subtool Tools; any other Tool renders its own Subtool panel instead.
 */
const SUBTOOL_HINTS: Partial<Record<ToolId, string>> = {
  select: 'Click an entity to select it.',
  region: 'Click the map to create or paint a region.',
  label: 'Click the map to place a label.',
  erase: 'Click a hex to erase it.',
};

/** A top-level Tool button in the primary selector row (issue #27). */
interface ToolDef {
  readonly id: ToolId;
  readonly label: string;
  readonly hint: string;
  readonly glyph: ToolGlyph;
}

/**
 * The primary Tool selector, in palette order. Each arms a top-level Tool; the
 * contextual panel below then shows only that Tool's Subtools (issue #27). The
 * keycap hints mirror the keyboard bindings in {@link map-canvas}.
 */
const TOOLS: readonly ToolDef[] = [
  { id: 'select', label: 'Select', hint: 'S', glyph: 'select' },
  { id: 'terrain', label: 'Terrain', hint: 'T', glyph: 'terrain' },
  { id: 'feature', label: 'Feature', hint: 'F', glyph: 'feature' },
  { id: 'region', label: 'Region', hint: 'R', glyph: 'region' },
  { id: 'label', label: 'Label', hint: 'L', glyph: 'label' },
  { id: 'erase', label: 'Erase', hint: 'E', glyph: 'erase' },
];

/**
 * The left rail: a primary Tool selector row (Select, Terrain, Feature, Region,
 * Label, Erase) plus a contextual panel showing only the armed Tool's Subtools —
 * terrain swatches, or feature icons + Clear — and undo/redo (issue #27, ADR-0010).
 * The armed Tool and its Subtools live in the shared {@link EditorStore} so the
 * canvas applies them (ADR-0005). The Region tool has no Subtools: it create-and-
 * paints from the canvas, and its details are edited in the Inspector (issue #38).
 */
@Component({
  selector: 'app-tool-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Eyebrow, Rule, ToolButton],
  template: `
    <section class="group">
      <h2 class="heading" appEyebrow>Tools</h2>
      <div class="list" role="group" aria-label="Tools">
        @for (t of tools; track t.id) {
          <button
            appTool
            [label]="t.label"
            [hint]="t.hint"
            [glyph]="t.glyph"
            [active]="store.tool() === t.id"
            [attr.aria-label]="t.label"
            [attr.data-testid]="'tool-' + t.id"
            (click)="store.armTool(t.id)"
          ></button>
        }
      </div>
    </section>

    <hr appRule />

    @switch (store.tool()) {
      @case ('terrain') {
        <section class="group">
          <h2 class="heading" appEyebrow>Terrain</h2>
          <div class="list" role="group" aria-label="Terrain">
            @for (t of terrainTools; track t.id) {
              <button
                appTool
                [label]="t.label"
                [hint]="t.hint"
                [swatch]="t.swatch"
                [active]="store.terrain() === t.id"
                [attr.aria-label]="t.label"
                (click)="store.armTerrain(t.id)"
              ></button>
            }
          </div>
        </section>
      }
      @case ('feature') {
        <section class="group">
          <h2 class="heading" appEyebrow>Features</h2>
          <div class="list" role="group" aria-label="Features">
            @for (f of features; track f.id) {
              <button
                appTool
                [label]="f.label"
                [iconPath]="f.path"
                [hint]="f.hint"
                [active]="store.feature() === f.id"
                [attr.aria-label]="f.label"
                [attr.data-testid]="'feature-' + f.id"
                (click)="store.armFeature(f.id)"
              ></button>
            }
            <button
              appTool
              label="Clear feature"
              [hint]="clearHint"
              [active]="store.feature() === 'clear'"
              aria-label="Clear feature"
              data-testid="clear-feature"
              (click)="store.armFeature('clear')"
            ></button>
          </div>
        </section>
      }
      @default {
        <!-- Select, Region, Label, and Erase have no Subtools (CONTEXT.md →
        Subtool). Region create-and-paints from the canvas (issue #38); its details
        are edited in the Inspector (#36). -->
        <p class="hint">{{ subtoolHint() }}</p>
      }
    }

    <div class="spacer"></div>

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
    .hint {
      margin: 0;
      padding: 0 var(--space-2);
      font-size: var(--text-sm);
      font-style: italic;
      color: var(--ink-muted);
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
  `,
})
export class ToolPalette {
  protected readonly store = inject(EditorStore);

  /** The primary Tool selector buttons, in palette order (issue #27). */
  protected readonly tools = TOOLS;

  /**
   * The built-in feature library, each placeable from the palette. The keycap is
   * the feature's slot in {@link featureSubtools}, the shared ordering the
   * keyboard indexes — so the hint can never disagree with what its key arms.
   */
  protected readonly features = featureLibrary.map((f) => ({
    id: f.id,
    label: f.label,
    path: f.path,
    hint: String(featureSubtools.indexOf(f.id) + 1),
  }));

  /** The keycap hint for the Clear feature Subtool — its slot in {@link featureSubtools}. */
  protected readonly clearHint = String(featureSubtools.indexOf('clear') + 1);

  /** The built-in terrain palette, with a 1-based number key per entry. */
  protected readonly terrainTools = terrainPalette.map((t, i) => ({
    id: t.id,
    label: t.label,
    swatch: t.fill,
    hint: String(i + 1),
  }));

  /** The one-line hint shown for a Tool that has no Subtool strip (issue #27). */
  protected readonly subtoolHint = computed(
    () => SUBTOOL_HINTS[this.store.tool()] ?? '',
  );
}
