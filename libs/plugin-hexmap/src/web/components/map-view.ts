import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { provideTranslocoScope, TranslocoPipe } from '@jsverse/transloco';
import { ENTITY_SESSION } from '@hexly/web-entity';
import { HEXMAP_TRANSLATIONS } from '../../i18n/hexmap-translations';
import { HexMapStore } from '../services/hexmap-store';
import { MapCanvas } from './map-canvas';
import { ToolPalette } from './tool-palette';
import { Inspector } from './inspector';
import { RegionsPanel } from './regions-panel';
import { EditorRail } from './editor-rail';

/**
 * The `core.view.map` renderer (ADR-0048, *Views* amendment): the full-bleed hex
 * canvas with its floating tool palette and Inspector / Regions dock. Lives in
 * the map plugin — it composes only this lib's pieces and reads its edit-ability off the
 * central {@link ENTITY_SESSION.writable} (the same token the {@link HexMapStore} edits
 * through), so it never reaches back to the app's session concretely.
 *
 * The canvas itself is a read affordance (pan/zoom); every editing dock is gated on
 * `writable()`, so a read-only opener (Viewer grant, read-only member, Public Link
 * reader, #162) sees the map but no tools (ADR-0037). `display:contents` so the
 * canvas and floating chrome position against the entity page's `<main>`.
 */
@Component({
  selector: 'app-map-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  // The Hex Map editor is this View's own store — scoped to the component that renders
  // it, not hoisted into the page/route composition roots (ADR-0048). It injects the
  // route-scoped ENTITY_SESSION from an ancestor, and lives and dies with the Map View:
  // its children (canvas, palette, docks) resolve this one instance.
  //
  // The `map` catalog rides along on the same injector (ADR-0049): this is the only component the
  // app mounts from this lib, and every `map.*` reader sits in this subtree, so the copy is fetched
  // when the hex map first renders and never before. Children inherit the scope from here.
  providers: [HexMapStore, provideTranslocoScope(HEXMAP_TRANSLATIONS)],
  imports: [MapCanvas, ToolPalette, Inspector, RegionsPanel, EditorRail, TranslocoPipe],
  template: `
    <!-- Full-bleed canvas; all side chrome floats over it (ADR-0013). -->
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
      <!--
        Right dock: panel (Inspector / Regions) + edge rail as a flex row, no
        hand-computed offsets (ADR-0013). pointer-events-none so the canvas stays
        interactive below a short panel; each child re-enables it.
      -->
      <div class="absolute top-3 right-3 bottom-3 flex items-start gap-2 z-[1] pointer-events-none">
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
  /** Drives the Inspector / Regions dock and holds the grid document. */
  protected readonly store = inject(HexMapStore);
  /** The central store; `writable()` gates the editing chrome (ADR-0037/0048). */
  protected readonly session = inject(ENTITY_SESSION);

  /** Hexes in the live document — the value the sr-only read-out and the e2e suite observe. */
  protected readonly hexCount = computed(() => Object.keys(this.store.document().hexes).length);
}
