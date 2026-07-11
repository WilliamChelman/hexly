import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { HexMapStore } from '../services/hexmap-store';
import { MapCanvas } from './map-canvas';
import { ToolPalette } from './tool-palette';
import { Inspector } from './inspector';
import { RegionsPanel } from './regions-panel';
import { EditorRail } from './editor-rail';

/**
 * The `core.view.map` renderer (ADR-0048, *Views* amendment): the full-bleed hex
 * canvas with its floating tool palette and Inspector / Regions dock. Lives in
 * web-map — it composes only this lib's pieces and reads its edit-ability off
 * {@link HexMapStore.editable} (fed by the owning session through the grid-store
 * port), so it never reaches back to the app's session.
 *
 * The canvas itself is a read affordance (pan/zoom); every editing dock is gated on
 * `editable()`, so a read-only opener (Viewer grant, read-only member, Public Link
 * reader, #162) sees the map but no tools (ADR-0037). `display:contents` so the
 * canvas and floating chrome position against the entity page's `<main>`.
 */
@Component({
  selector: 'app-map-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  imports: [MapCanvas, ToolPalette, Inspector, RegionsPanel, EditorRail],
  template: `
    <!-- Full-bleed canvas; all side chrome floats over it (ADR-0013). -->
    <app-map-canvas class="absolute inset-0" />
    @if (store.editable()) {
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
    }
  `,
  styles: `
    /*
      The palette's max-height is the one property with no faithful utility (a
      calc() over a token, ADR-0021), so it lives here. display:contents leaves the
      palette a descendant of the entity page's positioned <main>, so 100% resolves there.
    */
    app-tool-palette {
      max-height: calc(100% - 2 * calc(var(--spacing) * 3));
    }
  `,
})
export class MapView {
  /** Drives the Inspector / Regions dock, holds the grid document, and gates editing. */
  protected readonly store = inject(HexMapStore);
}
