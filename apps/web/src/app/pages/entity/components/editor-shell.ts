import {
  ChangeDetectionStrategy,
  Component,
  inject,
} from '@angular/core';
import { translateSignal } from '@jsverse/transloco';
import { HexMapStore } from '../services/hexmap-store';
import { EditorHeader } from './editor-header';
import { ToolPalette } from './tool-palette';
import { MapCanvas } from './map-canvas';
import { Inspector } from './inspector';
import { RegionsPanel } from './regions-panel';
import { EditorRail } from './editor-rail';
import { StatusBar } from './status-bar';
import { ContentEditor } from './content-editor';

/**
 * The editor's layout frame: arranges per-region components, owns no chrome.
 * A pure view of the open map — {@link EntityPage} loads the routed Entity into
 * {@link EntitySession} and dispatches here, so map→map nav swaps the canvas
 * without re-mounting.
 *
 * Full-bleed canvas with side chrome floating over it as absolute cards
 * (ADR-0013); the right panel renders only when {@link HexMapStore.rightPanel}
 * is open. Header and status bar stay docked as full-width rows.
 */
@Component({
  selector: 'app-editor-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full overflow-hidden' },
  imports: [
    EditorHeader,
    ToolPalette,
    MapCanvas,
    Inspector,
    RegionsPanel,
    EditorRail,
    StatusBar,
    ContentEditor,
  ],
  template: `
    <div class="grid grid-rows-[auto_1fr_var(--rail-status)] h-full">
      <!-- Page-owned header docked above the canvas (ADR-0022). -->
      <app-editor-header />
      <main class="body relative min-h-0">
        @if (store.view() === 'map') {
          <!-- Full-bleed canvas; all side chrome floats over it (ADR-0013). -->
          <app-map-canvas class="absolute inset-0" />
          <app-tool-palette class="absolute top-3 left-3 z-[1]" />
          <!--
            Right dock: panel (Inspector / Regions) + edge rail as a flex row, no
            hand-computed offsets (ADR-0013). pointer-events-none so the canvas stays
            interactive below a short panel; each child re-enables it.
          -->
          <div
            class="absolute top-3 right-3 bottom-3 flex items-start gap-2 z-[1] pointer-events-none"
          >
            @if (store.rightPanel() === 'regions') {
              <app-regions-panel
                class="w-[var(--rail-inspector)] max-h-full border border-line rounded-lg shadow-2 pointer-events-auto"
              />
            } @else if (store.rightPanel() === 'inspector') {
              <app-inspector
                class="w-[var(--rail-inspector)] max-h-full border border-line rounded-lg shadow-2 pointer-events-auto"
              />
            }
            <app-editor-rail class="pointer-events-auto" />
          </div>
        } @else {
          <!-- Note view (#75): the hexmap's Content body in a note page's centered reading column. -->
          <div class="absolute inset-0 overflow-y-auto bg-surface-sunken">
            <div class="max-w-[60rem] mx-auto py-5 px-5">
              <app-content-editor [ariaLabel]="editorLabel()" />
            </div>
          </div>
        }
      </main>
      <app-status-bar />
    </div>
  `,
  styles: `
    /*
      The palette's max-height is the one property with no faithful utility (a
      calc() over a token, ADR-0021), so it lives here; everything else is inline.
    */
    .body app-tool-palette {
      max-height: calc(100% - 2 * var(--spacing-3));
    }
  `,
})
export class EditorShell {
  /** Drives the Map/Note surface swap and which view occupies the right column. */
  protected readonly store = inject(HexMapStore);
  /** The Content editor's accessible name in the Note view (ADR-0014, #75). */
  protected readonly editorLabel = translateSignal('editorShell.view.editorLabel');
}
