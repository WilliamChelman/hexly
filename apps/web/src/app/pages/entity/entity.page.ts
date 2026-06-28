import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { translateSignal } from '@jsverse/transloco';
import { Observable, concat, ignoreElements, of } from 'rxjs';
import { EntitySession } from './services/entity-session';
import { HexMapStore } from './services/hexmap-store';
import { EntityHeader } from './components/entity-header';
import { ToolPalette } from './components/map/tool-palette';
import { MapCanvas } from './components/map/map-canvas';
import { Inspector } from './components/map/inspector';
import { RegionsPanel } from './components/map/regions-panel';
import { EditorRail } from './components/map/editor-rail';
import { StatusBar } from './components/map/status-bar';
import { ContentEditor } from './components/content-editor/content-editor';

/**
 * The open-Entity route (`/entities/:id`, #70): the routed page that loads the
 * Entity into {@link EntitySession} and lays out its editor — one frame for every
 * Entity type (ADR-0022).
 *
 * The shared {@link EntityHeader} docks above the body; the body is driven by the
 * open Entity:
 * - a `hexmap` shows the full-bleed map editor (canvas + chrome floating over it
 *   as absolute cards, ADR-0013) or — when its Map/Note toggle is on Note (#75) —
 *   its Content body, with the {@link StatusBar} docked below;
 * - a `note` shows only its Content body in a centred reading column (ADR-0019),
 *   with no grid and so no status bar or Map/Note toggle.
 *
 * Staying the routed component across `:id` changes keeps the editor mounted as
 * the open Entity swaps — only the body content changes, never the frame.
 */
@Component({
  selector: 'app-entity-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full overflow-hidden' },
  imports: [
    EntityHeader,
    ToolPalette,
    MapCanvas,
    Inspector,
    RegionsPanel,
    EditorRail,
    StatusBar,
    ContentEditor,
  ],
  template: `
    @if (session.current()) {
      <div
        class="grid h-full"
        [style.grid-template-rows]="
          isHexmap() ? 'auto 1fr var(--rail-status)' : 'auto 1fr'
        "
      >
        <!-- Page-owned header docked above the body (ADR-0022). -->
        <app-entity-header />
        <main class="body relative min-h-0">
          @if (showMap()) {
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
            <!-- Content body in a centred reading column: a note, or a hexmap on its Note view (#75). -->
            <div class="absolute inset-0 overflow-y-auto bg-surface-sunken">
              <div class="max-w-[60rem] mx-auto py-5 px-5">
                <app-content-editor [ariaLabel]="editorLabel()" />
              </div>
            </div>
          }
        </main>
        @if (isHexmap()) {
          <app-status-bar />
        }
      </div>
    }
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
export class EntityPage {
  protected readonly session = inject(EntitySession);
  /** Drives the Map/Note surface swap and which view occupies the right column. */
  protected readonly store = inject(HexMapStore);

  /** Only a hexmap carries a grid surface — and so the status bar and Map/Note toggle (#75). */
  protected readonly isHexmap = computed(
    () => this.session.current()?.document.type === 'hexmap',
  );

  /** Show the hex grid only for a hexmap on its Map view; everything else shows the Content body (#75). */
  protected readonly showMap = computed(
    () => this.isHexmap() && this.store.view() === 'map',
  );

  private readonly mapEditorLabel = translateSignal('editorShell.view.editorLabel');
  private readonly noteEditorLabel = translateSignal('noteView.editorLabel');
  /** The Content editor's accessible name, per Entity type (ADR-0014, #75). */
  protected readonly editorLabel = computed(() =>
    this.isHexmap() ? this.mapEditorLabel() : this.noteEditorLabel(),
  );

  constructor() {
    this.session.watchRoute(inject(ActivatedRoute));
  }

  /**
   * Awaited by the route's CanDeactivate guard (ADR-0026): persist any pending edit before
   * the route is torn down, then allow the leave. Always resolves true — a failed/timed-out
   * flush is best-effort and must never trap the user on the page.
   */
  canDeactivate(): Observable<boolean> {
    return concat(this.session.flush().pipe(ignoreElements()), of(true));
  }
}
