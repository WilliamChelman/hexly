import { ChangeDetectionStrategy, Component, inject, viewChild } from '@angular/core';
import { ENTITY_SESSION } from '@hexly/web-entity';
import { BoardCamera } from '../services/board-camera';
import { BoardImagePlacement } from '../services/board-image-placement';
import { BoardEmbedPlacement } from '../services/board-embed-placement';
import { BoardStore } from '../services/board-store';
import { BoardCanvasComponent } from './board-canvas.component';
import { BoardElementsComponent } from './board-elements.component';
import { ToolPaletteComponent } from './tool-palette.component';

/**
 * The `core.view.board` renderer (ADR-0048, *Views* amendment): the full-bleed board surface with its
 * floating tool palette.
 *
 * The Inspector is a page-Dock Panel now (ADR-0067) — declared on the board {@link ViewDefinition.panels}
 * and hosted by the page's Dock with this View's injector, driven by the {@link BoardStore}'s selection
 * claim — so the floating Inspector dock the View once owned is gone. What remains here is the canvas,
 * the element overlay, and the tool palette.
 *
 * The canvas grid is a read affordance (pan/zoom) and the element overlay renders for every session —
 * a read-only opener and an Embed's transclusion (ADR-0062) must see the Board's *content*, not a bare
 * grid, or nested Embeds never mount. Only the tool palette and the overlay's editing gestures are gated
 * on {@link ENTITY_SESSION.writable} (ADR-0037), mirroring the Hex Map View
 * whose content canvas renders outside the writable gate. A real full-bleed box (`absolute inset-0`),
 * not `display:contents`: this host carries the wheel listener, and a boxless host receives the bubbled
 * wheel as non-cancelable, so `preventDefault()` is silently dropped and a pinch zooms the whole page
 * (the 08bdd28 regression) — see {@link onWheel}. It fills the entity page's positioned `<main>`, so the
 * canvas and floating chrome position against it exactly as they did against `<main>`.
 *
 * Provides the route-scoped {@link BoardStore} (the surface document + tools + selection) and
 * {@link BoardCamera} (the shared pan/zoom the canvas and element overlay both read); both inject the
 * route-scoped `ENTITY_SESSION` from an ancestor. The `board` catalog is registered app-wide by
 * `providePluginBoard()` (ADR-0049), not here.
 */
@Component({
  selector: 'app-board-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'absolute inset-0', '(wheel)': 'onWheel($event)' },
  providers: [BoardStore, BoardCamera, BoardImagePlacement, BoardEmbedPlacement],
  imports: [BoardCanvasComponent, BoardElementsComponent, ToolPaletteComponent],
  template: `
    <!-- Full-bleed canvas grid; the element overlay and all side chrome float over it (ADR-0013). -->
    <app-board-canvas class="absolute inset-0" />
    <!-- The Board Element layer renders for every session (ADR-0062): read-only for a non-writable opener
         or an Embed's transclusion (no picks/drags/resizes), interactive when writable. Empty-plane
         presses fall through to the canvas below (its host is pointer-events-none, each box re-enables it). -->
    <app-board-elements [readOnly]="!session.writable()" />
    @if (session.writable()) {
      <app-board-tool-palette class="absolute top-3 left-3 z-[1]" />
    }
  `,
  styles: `
    /* The host is a full-bleed box filling <main>, so 100% resolves to the surface height. The palette's
       max-height is the one property with no faithful utility. */
    app-board-tool-palette {
      max-height: calc(100% - 2 * calc(var(--spacing) * 3));
    }
  `,
})
export class BoardViewComponent {
  /** The central session; `writable()` gates the editing chrome (ADR-0037/0048). */
  protected readonly session = inject(ENTITY_SESSION);

  private readonly canvas = viewChild.required(BoardCanvasComponent);
  private readonly elements = viewChild.required(BoardElementsComponent);

  /**
   * Pan/zoom the board from a wheel/pinch gesture. The listener sits on this host — the shared ancestor
   * of the canvas grid and the DOM element overlay — so it catches wheels over *both* layers; the
   * overlay's element boxes are `pointer-events-auto`, so a wheel over one targets the box and would
   * otherwise never reach the canvas' own listener (the reported bug). The math stays in
   * {@link BoardCanvasComponent}, which owns the surface rect the zoom anchors against.
   *
   * The host must be a real box (see the class doc): on a `display:contents` host the bubbled wheel is
   * non-cancelable, so `BoardCanvasComponent.onWheel`'s `preventDefault()` no-ops and a trackpad pinch
   * zooms the whole page instead of the board (the 08bdd28 regression). A real box keeps the wheel
   * cancelable, so Angular's non-passive `(wheel)` binding cancels it — mirroring the Hex Map, whose
   * `(wheel)` lives on its real `<canvas>` box.
   *
   * The camera is frozen while an element gesture (drag/resize) is in flight: the overlay's world math
   * snapshots the zoom at the press, so a pan/zoom mid-drag would move the board under the frozen
   * gesture. The wheel is swallowed (preventDefault, no camera) rather than left to bubble, or a
   * mid-drag pinch would zoom the whole page.
   *
   * Two regions keep the *plain* wheel to themselves, so it neither pans nor zooms the board: the
   * floating chrome (tool palette, zoom control, and the selected element's control strip — the strip
   * must not pan the board out from under its buttons; the Inspector is page-Dock chrome now, ADR-0067,
   * mounted outside this host so its wheels never reach here), and an
   * *armed* element's interactive content (a Text Block's live editor, an Embed's transclusion —
   * scrolling inside it must not move the board, CONTEXT.md → Text Block/Embed). Both are a `closest()`
   * containment test; not calling through leaves the native scroll and `preventDefault` to that inner
   * content. Ctrl/⌘+wheel is a zoom intent and is forwarded from both regions — returning without
   * preventDefault would let a pinch over the chrome or the armed editor zoom the whole page, the exact
   * 08bdd28 symptom.
   *
   * Every path that consumes the wheel (the mid-gesture swallow and the forward to the canvas) also
   * `stopPropagation()`s: a surface that handled a wheel must not let it drive an ancestor surface's
   * camera too — a Board transcluded into a Board would zoom both. The exempted paths deliberately
   * leave the event alone, bubbling and all, so the inner content's native scroll keeps working.
   */
  protected onWheel(event: WheelEvent): void {
    if (this.elements().gestureActive()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const target = event.target as HTMLElement | null;
    const zoomIntent = event.ctrlKey || event.metaKey;
    if (
      !zoomIntent &&
      target?.closest('app-board-tool-palette, app-board-zoom-control, app-board-element-controls, .element.is-armed')
    ) {
      return;
    }
    event.stopPropagation();
    this.canvas().onWheel(event);
  }
}
