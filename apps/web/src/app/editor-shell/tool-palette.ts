import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { featureLibrary, terrainPalette } from '@hexly/domain';
import { IconButton, IconButtonGlyph } from '../ui/icon-button';
import { Panel } from '../ui/panel';
import { Rule } from '../ui/rule';
import { EditorStore, featureSubtools, ToolId } from './editor-store';

/** A top-level Tool button in the floating icon strip (issue #27, ADR-0013). */
interface ToolDef {
  readonly id: ToolId;
  readonly label: string;
  /** The keycap that arms this Tool — surfaced in the tooltip (`Terrain (T)`). */
  readonly key: string;
  readonly glyph: IconButtonGlyph;
}

/**
 * The floating tool strip's Tools, in palette order. Each arms a top-level Tool;
 * the flyout then shows only that Tool's Subtools (issue #27). The keycaps mirror
 * the keyboard bindings in {@link map-canvas} and are surfaced in the tooltips.
 */
const TOOLS: readonly ToolDef[] = [
  { id: 'select', label: 'Select', key: 'S', glyph: 'select' },
  { id: 'terrain', label: 'Terrain', key: 'T', glyph: 'terrain' },
  { id: 'feature', label: 'Feature', key: 'F', glyph: 'feature' },
  { id: 'label', label: 'Label', key: 'L', glyph: 'label' },
  { id: 'erase', label: 'Erase', key: 'E', glyph: 'erase' },
];

/**
 * The floating tool palette: a compact icon strip in the top-left of the map —
 * one icon button per Tool (Select, Terrain, Feature, Label, Erase), plus Undo
 * and Redo below a divider — and a contextual flyout to its right that shows the
 * armed Tool's Subtools as an icon grid (terrain swatches, or feature icons +
 * Clear). The strip and flyout float as cards over the full-bleed canvas; the
 * shell positions this component top-left (ADR-0013).
 *
 * The flyout is bound to the armed Tool: it opens **only** for the Tools that
 * have Subtools (Terrain, Feature) and is absent for Select, Label, and Erase —
 * which have none — so the map stays maximally clear with nothing to configure.
 * Region is not a palette Tool (ADR-0012): while the membership brush is armed
 * (internal `region` state), the strip highlights no Tool and opens no flyout —
 * the active affordance is the Inspector's Add/Remove (issue #38, story 25).
 *
 * The armed Tool and its Subtools live in the shared {@link EditorStore} so the
 * canvas applies them (ADR-0005). Discoverability moves from inline labels to
 * `title` tooltips of the form `Terrain (T)` (name + keycap), per ADR-0013.
 */
@Component({
  selector: 'app-tool-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconButton, Panel, Rule],
  template: `
    <div class="strip" appPanel role="group" aria-label="Tools">
      @for (t of tools; track t.id) {
        <button
          appIconButton
          toggle
          [glyph]="t.glyph"
          [active]="store.tool() === t.id"
          [title]="t.label + ' (' + t.key + ')'"
          [attr.aria-label]="t.label"
          [attr.data-testid]="'tool-' + t.id"
          (click)="store.armTool(t.id)"
        ></button>
      }

      <hr appRule />

      <button
        appIconButton
        glyph="undo"
        title="Undo"
        aria-label="Undo"
        data-testid="undo"
        [disabled]="!store.canUndo()"
        (click)="store.undo()"
      ></button>
      <button
        appIconButton
        glyph="redo"
        title="Redo"
        aria-label="Redo"
        data-testid="redo"
        [disabled]="!store.canRedo()"
        (click)="store.redo()"
      ></button>
    </div>

    @switch (store.tool()) {
      @case ('terrain') {
        <div class="flyout" appPanel role="group" aria-label="Terrain">
          @for (t of terrainTools; track t.id) {
            <button
              appIconButton
              toggle
              [swatch]="t.swatch"
              [active]="store.terrain() === t.id"
              [title]="t.label + ' (' + t.key + ')'"
              [attr.aria-label]="t.label"
              (click)="store.armTerrain(t.id)"
            ></button>
          }
        </div>
      }
      @case ('feature') {
        <div class="flyout" appPanel role="group" aria-label="Features">
          @for (f of features; track f.id) {
            <button
              appIconButton
              toggle
              [iconPath]="f.path"
              [active]="store.feature() === f.id"
              [title]="f.label + ' (' + f.key + ')'"
              [attr.aria-label]="f.label"
              [attr.data-testid]="'feature-' + f.id"
              (click)="store.armFeature(f.id)"
            ></button>
          }
          <button
            appIconButton
            toggle
            glyph="minus"
            [active]="store.feature() === 'clear'"
            [title]="'Clear feature (' + clearKey + ')'"
            aria-label="Clear feature"
            data-testid="clear-feature"
            (click)="store.armFeature('clear')"
          ></button>
        </div>
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      align-items: flex-start;
      gap: var(--space-2);
    }
    .strip {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: var(--space-2);
      /* Cap to the host (the shell bounds it to the body) and scroll if a short
         viewport can't fit the whole strip, matching the flyout. */
      min-height: 0;
      max-height: 100%;
      overflow-y: auto;
    }
    .flyout {
      display: grid;
      grid-template-columns: repeat(2, auto);
      gap: 2px;
      padding: var(--space-2);
      max-height: 100%;
      overflow-y: auto;
    }
    hr[appRule] {
      width: 100%;
    }
  `,
})
export class ToolPalette {
  protected readonly store = inject(EditorStore);

  /** The floating strip's Tool buttons, in palette order (issue #27). */
  protected readonly tools = TOOLS;

  /**
   * The built-in feature library, each placeable from the flyout. The keycap is
   * the feature's slot in {@link featureSubtools}, the shared ordering the
   * keyboard indexes — so the tooltip can never disagree with what its key arms.
   */
  protected readonly features = featureLibrary.map((f) => ({
    id: f.id,
    label: f.label,
    path: f.path,
    key: String(featureSubtools.indexOf(f.id) + 1),
  }));

  /** The keycap for the Clear feature Subtool — its slot in {@link featureSubtools}. */
  protected readonly clearKey = String(featureSubtools.indexOf('clear') + 1);

  /** The built-in terrain palette, with a 1-based number key per entry. */
  protected readonly terrainTools = terrainPalette.map((t, i) => ({
    id: t.id,
    label: t.label,
    swatch: t.fill,
    key: String(i + 1),
  }));
}
