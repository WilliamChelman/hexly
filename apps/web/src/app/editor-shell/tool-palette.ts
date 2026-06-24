import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  Type,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { featureLibrary, terrainPalette } from '@hexly/domain';
import { IconButton } from '../ui/icon-button';
import { IconPath } from '../ui/icon/icon-path';
import { EraseIcon } from '../ui/icon/glyphs/erase';
import { LabelIcon } from '../ui/icon/glyphs/label';
import { MarqueeIcon } from '../ui/icon/glyphs/marquee';
import { MinusIcon } from '../ui/icon/glyphs/minus';
import { RedoIcon } from '../ui/icon/glyphs/redo';
import { SelectIcon } from '../ui/icon/glyphs/select';
import { SettlementIcon } from '../ui/icon/glyphs/settlement';
import { TerrainIcon } from '../ui/icon/glyphs/terrain';
import { UndoIcon } from '../ui/icon/glyphs/undo';
import { Panel } from '../ui/panel';
import { Rule } from '../ui/rule';
import { Swatch } from '../ui/swatch';
import { featureKey, terrainKey } from './catalog-keys';
import {
  EditorStore,
  featureSubtools,
  SelectSubtool,
  selectSubtools,
  ToolId,
} from './editor-store';

/** A top-level Tool button in the floating icon strip (issue #27, ADR-0013). */
interface ToolDef {
  readonly id: ToolId;
  /** The keycap that arms this Tool — surfaced in the tooltip (`Terrain (T)`). */
  readonly key: string;
  /** The glyph component projected into the button (ADR-0007); rendered via outlet. */
  readonly glyph: Type<unknown>;
}

/**
 * The floating tool strip's Tools, in palette order. Each arms a top-level Tool;
 * the flyout then shows only that Tool's Subtools (issue #27). The keycaps mirror
 * the keyboard bindings in {@link map-canvas} and are surfaced in the tooltips.
 * The visible name is resolved at the UI layer from the Tool's stable `id`
 * (`editorShell.toolPalette.<id>`, ADR-0014), so it can localize.
 */
const TOOLS: readonly ToolDef[] = [
  { id: 'select', key: 'S', glyph: SelectIcon },
  { id: 'terrain', key: 'T', glyph: TerrainIcon },
  { id: 'feature', key: 'F', glyph: SettlementIcon },
  { id: 'label', key: 'L', glyph: LabelIcon },
  { id: 'erase', key: 'E', glyph: EraseIcon },
];

/** The glyph for a Select Subtool: the arrow cursor for Pick, a dashed box for Marquee. */
function glyphFor(subtool: SelectSubtool): Type<unknown> {
  return subtool === 'marquee' ? MarqueeIcon : SelectIcon;
}

/**
 * The floating tool palette: a compact icon strip in the top-left of the map —
 * one icon button per Tool (Select, Terrain, Feature, Label, Erase), plus Undo
 * and Redo below a divider — and a contextual flyout to its right that shows the
 * armed Tool's Subtools as an icon grid (terrain swatches, or feature icons +
 * Clear). The strip and flyout float as cards over the full-bleed canvas; the
 * shell positions this component top-left (ADR-0013).
 *
 * The flyout is bound to the armed Tool: it opens **only** for the Tools that
 * have Subtools (Select with Pick/Marquee, Terrain, and Feature — ADR-0017) and
 * is absent for Label and Erase, which have none — so the map stays maximally
 * clear with nothing to configure.
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
  host: { class: 'flex items-start gap-2' },
  imports: [
    IconButton,
    IconPath,
    MinusIcon,
    NgComponentOutlet,
    RedoIcon,
    Swatch,
    UndoIcon,
    Panel,
    Rule,
    TranslocoPipe,
  ],
  template: `
    <div
      class="flex flex-col gap-[2px] p-2 min-h-0 max-h-full overflow-y-auto"
      appPanel
      role="group"
      [attr.aria-label]="'editorShell.toolPalette.tools' | transloco"
    >
      @for (t of tools; track t.id) {
        @let toolName = 'editorShell.toolPalette.' + t.id | transloco;
        <button
          appIconButton
          toggle
          [active]="store.tool() === t.id"
          [title]="toolName + ' (' + t.key + ')'"
          [attr.aria-label]="toolName"
          [attr.data-testid]="'tool-' + t.id"
          (click)="store.armTool(t.id)"
        >
          <ng-container *ngComponentOutlet="t.glyph; inputs: glyphInputs" />
        </button>
      }

      <hr appRule class="w-full" />

      <button
        appIconButton
        [title]="'editorShell.toolPalette.undo' | transloco"
        [attr.aria-label]="'editorShell.toolPalette.undo' | transloco"
        data-testid="undo"
        [disabled]="!store.canUndo()"
        (click)="store.undo()"
      >
        <app-icon-undo [size]="20" />
      </button>
      <button
        appIconButton
        [title]="'editorShell.toolPalette.redo' | transloco"
        [attr.aria-label]="'editorShell.toolPalette.redo' | transloco"
        data-testid="redo"
        [disabled]="!store.canRedo()"
        (click)="store.redo()"
      >
        <app-icon-redo [size]="20" />
      </button>
    </div>

    @switch (store.tool()) {
      @case ('select') {
        <div
          class="flyout"
          appPanel
          role="group"
          [attr.aria-label]="'editorShell.toolPalette.selectGroup' | transloco"
        >
          @for (s of selectTools; track s.id) {
            @let subName = s.nameKey | transloco;
            <button
              appIconButton
              toggle
              [active]="store.selectSubtool() === s.id"
              [title]="subName + ' (' + s.key + ')'"
              [attr.aria-label]="subName"
              [attr.data-testid]="'select-' + s.id"
              (click)="store.armSelectSubtool(s.id)"
            >
              <ng-container *ngComponentOutlet="s.glyph; inputs: glyphInputs" />
            </button>
          }
        </div>
      }
      @case ('terrain') {
        <div
          class="flyout"
          appPanel
          role="group"
          [attr.aria-label]="'editorShell.toolPalette.terrainGroup' | transloco"
        >
          @for (t of terrainTools; track t.id) {
            @let terrainName = t.nameKey | transloco;
            <button
              appIconButton
              toggle
              [active]="store.terrain() === t.id"
              [title]="terrainName + ' (' + t.key + ')'"
              [attr.aria-label]="terrainName"
              (click)="store.armTerrain(t.id)"
            >
              <span appSwatch [style.background]="'var(' + t.swatch + ')'"></span>
            </button>
          }
        </div>
      }
      @case ('feature') {
        <div
          class="flyout"
          appPanel
          role="group"
          [attr.aria-label]="'editorShell.toolPalette.featureGroup' | transloco"
        >
          @for (f of features; track f.id) {
            @let featureName = f.nameKey | transloco;
            <button
              appIconButton
              toggle
              [active]="store.feature() === f.id"
              [title]="featureName + ' (' + f.key + ')'"
              [attr.aria-label]="featureName"
              [attr.data-testid]="'feature-' + f.id"
              (click)="store.armFeature(f.id)"
            >
              <app-icon-path [d]="f.path" [size]="20" />
            </button>
          }
          <button
            appIconButton
            toggle
            [active]="store.feature() === 'clear'"
            [title]="
              ('editorShell.toolPalette.clearFeature' | transloco) +
              ' (' + clearKey + ')'
            "
            [attr.aria-label]="'editorShell.toolPalette.clearFeature' | transloco"
            data-testid="clear-feature"
            (click)="store.armFeature('clear')"
          >
            <app-icon-minus [size]="20" />
          </button>
        </div>
      }
    }
  `,
  styles: `
    /* The flyout's two-column grid keeps a scoped rule: the class is a test hook
       and the grid template reads better named here than as triplicated inline
       arbitrary utilities. Strip layout + the divider width are inline utilities. */
    .flyout {
      display: grid;
      grid-template-columns: repeat(2, auto);
      gap: 2px;
      padding: var(--spacing-2);
      max-height: 100%;
      overflow-y: auto;
    }
  `,
})
export class ToolPalette {
  protected readonly store = inject(EditorStore);

  /** The floating strip's Tool buttons, in palette order (issue #27). */
  protected readonly tools = TOOLS;

  /** Inputs for each outlet-rendered Tool glyph; matches the 20px icon-only chrome. */
  protected readonly glyphInputs = { size: 20 };

  /**
   * The Select tool's Subtools — Pick then Marquee — each placeable from the
   * Select flyout (ADR-0017). The keycap is the Subtool's slot in
   * {@link selectSubtools}, the shared ordering the keyboard `1`/`2` indexes — so
   * the tooltip can never disagree with what its key arms. The glyph is the arrow
   * cursor for Pick, a dashed box for Marquee; the name resolves from the stable
   * id (`editorShell.toolPalette.<id>`, ADR-0014).
   */
  protected readonly selectTools = selectSubtools.map((id, i) => ({
    id,
    nameKey: `editorShell.toolPalette.${id}`,
    glyph: glyphFor(id),
    key: String(i + 1),
  }));

  /**
   * The built-in feature library, each placeable from the flyout. The keycap is
   * the feature's slot in {@link featureSubtools}, the shared ordering the
   * keyboard indexes — so the tooltip can never disagree with what its key arms.
   */
  protected readonly features = featureLibrary.map((f) => ({
    id: f.id,
    nameKey: featureKey(f.id),
    path: f.path,
    key: String(featureSubtools.indexOf(f.id) + 1),
  }));

  /** The keycap for the Clear feature Subtool — its slot in {@link featureSubtools}. */
  protected readonly clearKey = String(featureSubtools.indexOf('clear') + 1);

  /** The built-in terrain palette, with a 1-based number key per entry. The name
   * is resolved from the id (`domain.terrain.<id>`, ADR-0014). */
  protected readonly terrainTools = terrainPalette.map((t, i) => ({
    id: t.id,
    nameKey: terrainKey(t.id),
    swatch: t.fill,
    key: String(i + 1),
  }));
}
