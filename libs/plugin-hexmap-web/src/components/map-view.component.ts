import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ENTITY_SESSION } from '@hexly/web-entity';
import { HexMapStore } from '../services/hexmap-store';
import { MapCanvasComponent } from './map-canvas.component';
import { ToolPaletteComponent } from './tool-palette.component';

/**
 * The `core.view.map` renderer (ADR-0048, *Views* amendment): the full-bleed hex canvas with its
 * floating tool palette.
 *
 * The Inspector and Regions are page-Dock Panels now (ADR-0067) — declared on the map
 * {@link ViewDefinition.panels} and hosted by the page's Dock with this View's injector — so the
 * right-edge editor-rail the View once owned, and its floating panel dock, are gone. What remains here
 * is the canvas and the tool palette.
 *
 * The canvas itself is a read affordance (pan/zoom); the tool palette is gated on
 * {@link ENTITY_SESSION.writable}, so a read-only opener sees the map but no tools (ADR-0037) — as are
 * the two Dock Panels, write-gated by their definitions. `display:contents` so the canvas and floating
 * chrome position against the entity page's `<main>`.
 */
@Component({
  selector: 'app-map-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  // The store lives and dies with the Map View; its children (canvas, palette) and the page Dock's
  // View-contributed Panels (Inspector, Regions) resolve this one instance, and it injects the
  // route-scoped ENTITY_SESSION from an ancestor (ADR-0048).
  //
  // The `map` catalog is *not* provided here: it is an eager scope registered app-wide by
  // `providePluginHexmap()` (ADR-0049), because the type's chrome labels are `map.*` keys the app's
  // header, browser, and command palette render, where no pipe of this lib exists to trigger a lazy
  // load.
  providers: [HexMapStore],
  imports: [MapCanvasComponent, ToolPaletteComponent, TranslocoPipe],
  template: `
    <!-- Full-bleed canvas; the tool palette floats over it (ADR-0013). -->
    <app-map-canvas class="absolute inset-0" />
    <!--
      The model-derived hex count, kept as a screen-reader-only live region rather
      than visible chrome (the status bar was retired with the Views refactor). The
      map is Canvas pixels (ADR-0003), so this is the one accessible read-out of how
      many hexes the live document holds — a11y for non-sighted users and the sole
      observable the e2e suite polls to prove a canvas gesture reached the document.
      Outside the writable gate: a read-only opener's map still has a hex count.
    -->
    <span class="sr-only" aria-live="polite" data-testid="hex-count">{{
      'map.statusBar.hexCount' | transloco: { count: hexCount() }
    }}</span>
    @if (session.writable()) {
      <app-tool-palette class="absolute top-3 left-3 z-[1]" />
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
export class MapViewComponent {
  /** The central store; holds the grid document the hex read-out counts. */
  protected readonly store = inject(HexMapStore);
  /** The central store; `writable()` gates the editing chrome (ADR-0037/0048). */
  protected readonly session = inject(ENTITY_SESSION);

  /** Hexes in the live document — the value the sr-only read-out and the e2e suite observe. */
  protected readonly hexCount = computed(() => Object.keys(this.store.document().hexes).length);
}
