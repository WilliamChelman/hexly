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
 * The editor's layout orchestrator. It owns no chrome of its own — each region
 * (header, tool palette, canvas, inspector, status bar) is its own component —
 * only the frame that arranges them. It is a pure view of the open map:
 * {@link EntityPage} loads the routed Entity into the {@link EntitySession} and
 * dispatches to this, so a map→map navigation swaps the canvas without
 * re-mounting the editor.
 *
 * The body is a **full-bleed canvas** with the side chrome floating over it as
 * absolutely-positioned cards (ADR-0013): the tool palette anchors top-left, the
 * edge rail top-right, and the dismissible right panel (Inspector / Regions) to
 * the rail's left — rendered only when {@link HexMapStore.rightPanel} is open, so
 * nothing covers the map by default. The header and status bar stay docked as
 * full-width rows. The editor renders identically at every width.
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
      <!-- Page-owned header: the map's own controls, docked above the canvas (ADR-0022). -->
      <app-editor-header />
      <main class="body relative min-h-0">
        @if (store.view() === 'map') {
          <!-- Full-bleed canvas; all side chrome floats over it (ADR-0013). -->
          <app-map-canvas class="absolute inset-0" />
          <app-tool-palette class="absolute top-3 left-3 z-[1]" />
          <!--
            Right dock: panel (Inspector / Regions) + edge rail as a flex row — no
            hand-computed offsets (ADR-0013). pointer-events-none so the canvas stays
            interactive below a short panel; each child re-enables with pointer-events-auto.
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
          <!--
            Note view (#75): the hexmap's Content body in the same centered reading
            column a note page uses, scrolling within the body below the header.
          -->
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
      The body is the floating-chrome stacking context (via its own 'relative'
      utility): it lays out its children — the full-bleed canvas and the tool
      palette are positioned with inline utilities, and the side chrome floats over
      them. The palette's max-height is the one property with no faithful utility (a
      calc() over a token, which ADR-0021 keeps scoped), so it's split off here on
      its own; the rest of the palette's placement, the shell grid, the right-dock
      layout, and the floating card chrome are all inline on their elements.
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
