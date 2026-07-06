import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { featureLibrary, terrainPalette } from '@hexly/domain';
import { IconButton } from '../../../../ui/icon-button';
import { Icon, IconName } from '../../../../ui/icon/icon';
import { IconPath } from '../../../../ui/icon/icon-path';
import { Panel } from '../../../../ui/panel';
import { Rule } from '../../../../ui/rule';
import { Swatch } from '../../../../ui/swatch';
import { featureKey, terrainKey } from '../../utils/catalog-keys';
import {
  HexMapStore,
  featureSubtools,
  SelectSubtool,
  selectSubtools,
} from '../../services/hexmap-store';
import { TOOLS } from './tools';

/** The glyph for a Select Subtool: the arrow cursor for Pick, a dashed box for Marquee. */
function glyphFor(subtool: SelectSubtool): IconName {
  return subtool === 'marquee' ? 'marquee' : 'select';
}

/**
 * Floating tool palette: icon strip + contextual flyout of Subtools (ADR-0013, ADR-0017).
 * Flyout opens only for Tools with Subtools (Select, Terrain, Feature). Region is not
 * a palette Tool (ADR-0012): affordance is the Inspector's Add/Remove.
 * Armed Tool lives in {@link HexMapStore} so canvas applies it (ADR-0005).
 */
@Component({
  selector: 'app-tool-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex items-start gap-2' },
  imports: [IconButton, Icon, IconPath, Swatch, Panel, Rule, TranslocoPipe],
  template: `
    <div
      class="flex flex-col gap-2 p-2 min-h-0 max-h-full overflow-y-auto"
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
          <app-icon [name]="t.glyph" [size]="20" />
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
        <app-icon name="undo" [size]="20" />
      </button>
      <button
        appIconButton
        [title]="'editorShell.toolPalette.redo' | transloco"
        [attr.aria-label]="'editorShell.toolPalette.redo' | transloco"
        data-testid="redo"
        [disabled]="!store.canRedo()"
        (click)="store.redo()"
      >
        <app-icon name="redo" [size]="20" />
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
              <app-icon [name]="s.glyph" [size]="20" />
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
            <app-icon name="minus" [size]="20" />
          </button>
        </div>
      }
    }
  `,
  styles: `
    @reference '#app-styles.css';

    /* The flyout's two-column grid is scoped here (the class is also a test hook);
       strip layout and divider width are inline utilities. */
    .flyout {
      @apply grid grid-cols-[repeat(2,auto)] gap-2 p-2 max-h-full overflow-y-auto;
    }
  `,
})
export class ToolPalette {
  protected readonly store = inject(HexMapStore);

  // Keycap is the hotkey upper-cased for display; the letter itself lives in TOOLS,
  // shared with the keyboard so the tooltip can't disagree with what the key arms.
  protected readonly tools = TOOLS.map((t) => ({
    id: t.id,
    glyph: t.glyph,
    key: t.hotkey.toUpperCase(),
  }));

  // Select Subtools: keycap is the slot in selectSubtools, shared with keyboard 1/2.
  protected readonly selectTools = selectSubtools.map((id, i) => ({
    id,
    nameKey: `editorShell.toolPalette.${id}`,
    glyph: glyphFor(id),
    key: String(i + 1),
  }));

  protected readonly features = featureLibrary.map((f) => ({
    id: f.id,
    nameKey: featureKey(f.id),
    path: f.path,
    key: String(featureSubtools.indexOf(f.id) + 1),
  }));

  protected readonly clearKey = String(featureSubtools.indexOf('clear') + 1);

  protected readonly terrainTools = terrainPalette.map((t, i) => ({
    id: t.id,
    nameKey: terrainKey(t.id),
    swatch: t.fill,
    key: String(i + 1),
  }));
}
