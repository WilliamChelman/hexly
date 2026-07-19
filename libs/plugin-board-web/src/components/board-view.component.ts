import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ENTITY_SESSION } from '@hexly/web-entity';
import { BoardCamera } from '../services/board-camera';
import { BoardImagePlacement } from '../services/board-image-placement';
import { BoardEmbedPlacement } from '../services/board-embed-placement';
import { BoardStore } from '../services/board-store';
import { BoardCanvasComponent } from './board-canvas.component';
import { BoardElementsComponent } from './board-elements.component';
import { ToolPaletteComponent } from './tool-palette.component';
import { InspectorComponent } from './inspector.component';

/**
 * The `core.view.board` renderer (ADR-0048, *Views* amendment): the full-bleed board surface with its
 * floating tool palette and Inspector dock (#267, Seam B).
 *
 * The canvas grid is a read affordance (pan/zoom); the element overlay and every editing dock are gated
 * on {@link ENTITY_SESSION.writable}, so a read-only opener sees the plane but no editing chrome
 * (ADR-0037), mirroring the Hex Map View. `display:contents` so the canvas and floating chrome position
 * against the entity page's `<main>`.
 *
 * Provides the route-scoped {@link BoardStore} (the surface document + tools + selection) and
 * {@link BoardCamera} (the shared pan/zoom the canvas and element overlay both read); both inject the
 * route-scoped `ENTITY_SESSION` from an ancestor. The `board` catalog is registered app-wide by
 * `providePluginBoard()` (ADR-0049), not here.
 */
@Component({
  selector: 'app-board-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  providers: [BoardStore, BoardCamera, BoardImagePlacement, BoardEmbedPlacement],
  imports: [BoardCanvasComponent, BoardElementsComponent, ToolPaletteComponent, InspectorComponent],
  template: `
    <!-- Full-bleed canvas grid; the element overlay and all side chrome float over it (ADR-0013). -->
    <app-board-canvas class="absolute inset-0" />
    @if (session.writable()) {
      <!-- The interactive Board Element layer: picks, drags, resizes; empty-plane presses fall through
           to the canvas below (its host is pointer-events-none, each element box re-enables it). -->
      <app-board-elements />
      <app-board-tool-palette class="absolute top-3 left-3 z-[1]" />
      <!--
        Right dock: the Inspector as a flex row, no hand-computed offsets (ADR-0013). pointer-events-none
        so the canvas stays interactive below a short panel; the panel re-enables it.
      -->
      <div class="absolute top-3 right-3 bottom-3 flex items-start gap-2 z-[1] pointer-events-none">
        <app-board-inspector
          class="w-[var(--rail-inspector)] max-h-full border border-line rounded-lg shadow-2 pointer-events-auto"
        />
      </div>
    }
  `,
  styles: `
    /* display:contents leaves the palette a descendant of the entity page's positioned <main>, so 100%
       resolves there. The palette's max-height is the one property with no faithful utility. */
    app-board-tool-palette {
      max-height: calc(100% - 2 * calc(var(--spacing) * 3));
    }
  `,
})
export class BoardViewComponent {
  /** The central session; `writable()` gates the editing chrome (ADR-0037/0048). */
  protected readonly session = inject(ENTITY_SESSION);
}
