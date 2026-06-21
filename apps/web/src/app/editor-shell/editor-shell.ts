import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, EMPTY, filter, map, switchMap } from 'rxjs';
import { EditorSession } from './editor-session';
import { EditorStore } from './editor-store';
import { EditorHeader } from './editor-header';
import { ToolPalette } from './tool-palette';
import { MapCanvas } from './map-canvas';
import { Inspector } from './inspector';
import { RegionsPanel } from './regions-panel';
import { EditorRail } from './editor-rail';
import { StatusBar } from './status-bar';

/**
 * The editor's layout orchestrator. It owns no chrome of its own — each region
 * (header, tool palette, canvas, inspector, status bar) is its own component —
 * only the frame that arranges them, plus the one piece of routing it is
 * responsible for: opening the map named by the `:id` route param into the
 * {@link EditorSession} so a reload restores it.
 *
 * The body is a **full-bleed canvas** with the side chrome floating over it as
 * absolutely-positioned cards (ADR-0013, reversing ADR-0007's column grid and
 * ADR-0011's always-present right column): the tool palette anchors top-left, the
 * edge rail top-right, and the dismissible right panel (Inspector / Regions) to
 * the rail's left — rendered only when {@link EditorStore.rightPanel} is open, so
 * nothing covers the map by default. The header and status bar stay docked as
 * full-width rows. The editor renders identically at every width — the old
 * narrow-viewport rail-hiding is gone.
 */
@Component({
  selector: 'app-editor-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    EditorHeader,
    ToolPalette,
    MapCanvas,
    Inspector,
    RegionsPanel,
    EditorRail,
    StatusBar,
  ],
  template: `
    <div class="shell">
      <app-editor-header />
      <div class="body">
        <!-- Full-bleed canvas; all side chrome floats over it (ADR-0013). -->
        <app-map-canvas />
        <app-tool-palette />
        <!--
          The right dock: the dismissible panel (Inspector / Regions) and the edge
          rail laid out as one flex row, so the panel always sits just left of the
          rail with a consistent gap — no hand-computed offsets (ADR-0013). The
          rail toggles the Regions list on and off; selecting an entity or a Region
          opens the Inspector. When the panel is closed (rightPanel is null) only
          the bare rail shows, so the map is clear.
        -->
        <div class="right-dock">
          @if (store.rightPanel() === 'regions') {
            <app-regions-panel />
          } @else if (store.rightPanel() === 'inspector') {
            <app-inspector />
          }
          <app-editor-rail />
        </div>
      </div>
      <app-status-bar />
    </div>
  `,
  styles: `
    :host {
      display: block;
      height: 100vh;
      overflow: hidden;
    }
    .shell {
      display: grid;
      grid-template-rows: var(--rail-header) 1fr var(--rail-status);
      height: 100vh;
    }
    /* The body is the floating-chrome stacking context; the canvas fills it. */
    .body {
      position: relative;
      min-height: 0;
    }
    .body app-map-canvas {
      position: absolute;
      inset: 0;
    }
    /* Tool palette anchored top-left; rail top-right; panel to the rail's left. */
    .body app-tool-palette {
      position: absolute;
      top: var(--space-3);
      left: var(--space-3);
      max-height: calc(100% - 2 * var(--space-3));
      z-index: 1;
    }
    /*
      The right dock floats top-right and lays the panel + rail out as a row. It
      spans the body's height (top..bottom) so the panel can cap its height and
      scroll internally (story 22); pointer-events pass through its empty area so
      the canvas stays interactive below a short panel.
    */
    .right-dock {
      position: absolute;
      top: var(--space-3);
      right: var(--space-3);
      bottom: var(--space-3);
      display: flex;
      align-items: flex-start;
      gap: var(--space-2);
      z-index: 1;
      pointer-events: none;
    }
    .right-dock > * {
      pointer-events: auto;
    }
    /*
      The floating Inspector / Regions card sits just left of the rail, capped to
      the dock height and scrolling internally, with full card chrome (edge,
      radius, shadow) over the map.
    */
    .right-dock app-inspector,
    .right-dock app-regions-panel {
      width: var(--rail-inspector);
      max-height: 100%;
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-2);
    }
  `,
})
export class EditorShell {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly session = inject(EditorSession);
  /** Drives which view occupies the shared right column (Inspector vs Regions list). */
  protected readonly store = inject(EditorStore);

  constructor() {
    // Open whatever map the URL points at, and reopen it if the id changes
    // (e.g. navigating between maps without leaving the editor). `switchMap`
    // cancels an in-flight open when the id changes, so navigating /maps/A then
    // /maps/B can't let a late A response overwrite B's canvas (#1).
    this.route.paramMap
      .pipe(
        map((params) => params.get('id')),
        filter((id): id is string => id !== null),
        switchMap((id) =>
          this.session.openRoute(id).pipe(
            // A failed open (404 — a deleted, foreign, or typo'd id) sends the
            // user back to the library rather than stranding them on a silently
            // blank editor (#3).
            catchError(() => {
              this.router.navigateByUrl('/maps');
              return EMPTY;
            }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe();
  }
}
