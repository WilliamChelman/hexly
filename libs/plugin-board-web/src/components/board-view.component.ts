import { ChangeDetectionStrategy, Component, inject, viewChild } from '@angular/core';
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
 * The canvas grid is a read affordance (pan/zoom) and the element overlay renders for every session —
 * a read-only opener and an Embed's transclusion (ADR-0062) must see the Board's *content*, not a bare
 * grid, or nested Embeds never mount. Only the editing docks (tool palette, Inspector) and the overlay's
 * editing gestures are gated on {@link ENTITY_SESSION.writable} (ADR-0037), mirroring the Hex Map View
 * whose content canvas renders outside the writable gate. `display:contents` so the canvas and floating
 * chrome position against the entity page's `<main>`.
 *
 * Provides the route-scoped {@link BoardStore} (the surface document + tools + selection) and
 * {@link BoardCamera} (the shared pan/zoom the canvas and element overlay both read); both inject the
 * route-scoped `ENTITY_SESSION` from an ancestor. The `board` catalog is registered app-wide by
 * `providePluginBoard()` (ADR-0049), not here.
 */
@Component({
  selector: 'app-board-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents', '(wheel)': 'onWheel($event)' },
  providers: [BoardStore, BoardCamera, BoardImagePlacement, BoardEmbedPlacement],
  imports: [BoardCanvasComponent, BoardElementsComponent, ToolPaletteComponent, InspectorComponent],
  template: `
    <!-- Full-bleed canvas grid; the element overlay and all side chrome float over it (ADR-0013). -->
    <app-board-canvas class="absolute inset-0" />
    <!-- The Board Element layer renders for every session (ADR-0062): read-only for a non-writable opener
         or an Embed's transclusion (no picks/drags/resizes), interactive when writable. Empty-plane
         presses fall through to the canvas below (its host is pointer-events-none, each box re-enables it). -->
    <app-board-elements [readOnly]="!session.writable()" />
    @if (session.writable()) {
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

  private readonly canvas = viewChild.required(BoardCanvasComponent);

  /**
   * Pan/zoom the board from a wheel/pinch gesture. The listener sits on this host — the shared ancestor
   * of the canvas grid and the DOM element overlay — so it catches wheels over *both* layers; the
   * overlay's element boxes are `pointer-events-auto`, so a wheel over one targets the box and would
   * otherwise never reach the canvas' own listener (the reported bug). The math stays in
   * {@link BoardCanvasComponent}, which owns the surface rect the zoom anchors against.
   *
   * Two regions keep the wheel to themselves, so it neither pans nor zooms the board: the floating chrome
   * (tool palette, Inspector, zoom control — the Inspector must scroll), and an *armed* element's
   * interactive content (a Text Block's live editor, an Embed's transclusion — scrolling inside it must
   * not move the board, CONTEXT.md → Text Block/Embed). Both are a `closest()` containment test; not
   * calling through leaves the native scroll and `preventDefault` to that inner content.
   */
  protected onWheel(event: WheelEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest('app-board-tool-palette, app-board-inspector, app-board-zoom-control, .element.is-armed')) {
      return;
    }
    this.canvas().onWheel(event);
  }
}
