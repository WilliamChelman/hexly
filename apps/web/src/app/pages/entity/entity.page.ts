import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { TranslocoPipe, translateSignal } from '@jsverse/transloco';
import { Observable, concat, ignoreElements, of } from 'rxjs';
import { EntitySession } from './services/entity-session';
import { OutlineStore } from './services/outline-store';
import { EntityHeader } from './components/entity-header';
import {
  HexMapStore,
  ToolPalette,
  MapCanvas,
  Inspector,
  RegionsPanel,
  EditorRail,
  StatusBar,
} from '@hexly/web-map';
import { ContentEditor } from '@hexly/content-editor';
import { EntityMetadata } from './components/entity-metadata';
import { OutlinePanel } from './components/outline-panel';
import { OutlineSource } from './components/outline-source';
import { IconButton, Icon } from '@hexly/web-ui';

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
    EntityMetadata,
    OutlinePanel,
    OutlineSource,
    IconButton,
    Icon,
    TranslocoPipe,
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
            <!-- Full-bleed canvas; all side chrome floats over it (ADR-0013). The canvas
                 itself is a read affordance (pan/zoom); every editing dock below is gated on
                 writable() so a read-only opener sees the map but no tools (ADR-0037, #162). -->
            <app-map-canvas class="absolute inset-0" />
            @if (writable()) {
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
          } @else {
            <!-- Content body in a centred reading column: a note, or a hexmap on its Note view (#75).
                 Opening the Outline reflows this column left (extra right padding) so the panel never
                 overlaps prose; closed still reserves room for the floating toggle. -->
            <div
              data-content-scroll
              class="absolute inset-0 overflow-y-auto bg-surface-sunken transition-[padding] duration-200"
              [style.paddingRight]="outline.isOpen() ? '20rem' : '3.5rem'"
            >
              <div class="max-w-[60rem] mx-auto py-6 px-6">
                <app-entity-metadata />
                <app-content-editor appOutlineSource [ariaLabel]="editorLabel()" />
              </div>
            </div>
            <!-- Outline dock floating top-right (mirrors the map dock, ADR-0013): panel left of a
                 single toggle button; pointer-events re-enabled per child. -->
            <div
              class="absolute top-3 right-3 bottom-3 flex items-start gap-2 z-[1] pointer-events-none"
            >
              @if (outline.isOpen()) {
                <app-outline-panel
                  class="w-[16rem] max-h-full border border-line rounded-lg shadow-2 pointer-events-auto"
                />
              }
              <button
                appIconButton
                toggle
                class="pointer-events-auto"
                [active]="outline.isOpen()"
                [title]="outlineToggleLabel()"
                [attr.aria-label]="outlineToggleLabel()"
                data-testid="outline-toggle"
                (click)="outline.toggle()"
              >
                <app-icon name="outline" [size]="20" />
              </button>
            </div>
          }
        </main>
        @if (isHexmap()) {
          <app-status-bar />
        }
      </div>
    } @else if (session.evicted()) {
      <!-- Live eviction (ADR-0044, #174): the followed Entity became unreachable (deleted,
           made private, or un-shared) — an honest empty state instead of stale content. -->
      <div
        data-testid="entity-unavailable"
        class="h-full flex flex-col items-center justify-center gap-2 text-center px-6"
        role="status"
      >
        <p class="text-lg font-medium">
          {{ 'editorShell.unavailable.title' | transloco }}
        </p>
        <p class="text-ink-muted">
          {{ 'editorShell.unavailable.body' | transloco }}
        </p>
      </div>
    }
  `,
  styles: `
    /*
      The palette's max-height is the one property with no faithful utility (a
      calc() over a token, ADR-0021), so it lives here; everything else is inline.
    */
    .body app-tool-palette {
      max-height: calc(100% - 2 * calc(var(--spacing) * 3));
    }
  `,
})
export class EntityPage {
  protected readonly session = inject(EntitySession);
  /**
   * Whether the caller may edit (ADR-0037). Gates the map's editing docks — a read-only
   * opener (Viewer grant, read-only member, or Public Link reader, #162) gets the canvas
   * as pan/zoom-only, with the tool palette, inspector, and editor rail withheld.
   */
  protected readonly writable = this.session.writable;
  /** Drives the Map/Note surface swap and which view occupies the right column. */
  protected readonly store = inject(HexMapStore);
  /** The heading-navigation Outline shown beside the Content body. */
  protected readonly outline = inject(OutlineStore);

  /** Accessible name / tooltip for the Outline toggle (ADR-0014). */
  protected readonly outlineToggleLabel = translateSignal('noteView.outline.toggle');

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
