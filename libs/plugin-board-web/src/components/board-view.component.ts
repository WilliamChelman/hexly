import { ChangeDetectionStrategy, Component } from '@angular/core';
import { BoardStore } from '../services/board-store';
import { BoardCanvasComponent } from './board-canvas.component';

/**
 * The `core.view.board` renderer (ADR-0048, *Views* amendment): the full-bleed board surface. This
 * ticket (#266) stands it up as the empty, navigable plane — the canvas is a read affordance (pan/zoom)
 * with no editing chrome yet; the tool docks arrive with element operations in a later ticket.
 *
 * `display:contents` so the canvas positions against the entity page's `<main>`. Provides the
 * route-scoped {@link BoardStore} — it holds the surface document the coming element operations edit,
 * and it injects the route-scoped `ENTITY_SESSION` from an ancestor (ADR-0048).
 *
 * The `board` catalog is *not* provided here: it is an eager scope registered app-wide by
 * `providePluginBoard()` (ADR-0049), because the type's chrome labels are `board.*` keys the app's
 * header, browser, and command palette render, where no pipe of this lib exists to trigger a lazy load.
 */
@Component({
  selector: 'app-board-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  providers: [BoardStore],
  imports: [BoardCanvasComponent],
  template: `
    <!-- Full-bleed canvas; any future side chrome floats over it (ADR-0013). -->
    <app-board-canvas class="absolute inset-0" />
  `,
})
export class BoardViewComponent {}
