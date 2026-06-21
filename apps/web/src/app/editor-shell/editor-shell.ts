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
 * only the three-row / three-column frame that arranges them (ADR-0007), plus
 * the one piece of routing it is responsible for: opening the map named by the
 * `:id` route param into the {@link EditorSession} so a reload restores it.
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
        <app-tool-palette />
        <app-map-canvas />
        <!--
          The shared right column (ADR-0011): the right-edge rail flips it between
          the live Inspector and the Regions panel's list; selecting a Region flips
          it back to the Inspector. The rail itself stays pinned to the edge.
        -->
        @if (store.rightPanel() === 'regions') {
          <app-regions-panel />
        } @else {
          <app-inspector />
        }
        <app-editor-rail />
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
    .body {
      display: grid;
      grid-template-columns: var(--rail-tools) 1fr var(--rail-inspector) var(--rail-edge);
      min-height: 0;
    }
    /*
      Narrow viewports: collapse the left tool palette so the canvas stays
      usable, but KEEP the right-edge rail beside the canvas — it is the only
      way to open the Regions panel now that the palette tool and canvas
      create-and-paint are gone (FIX 5). The active right column (Inspector or
      Regions list) can't fit a column at this width, so it overlays the canvas
      area instead; the rail's Regions entry toggles it open/closed.
    */
    @media (max-width: 1080px) {
      .body {
        /* canvas takes the remaining width; the thin rail stays pinned beside it */
        grid-template-columns: 1fr var(--rail-edge);
        position: relative;
      }
      .body app-tool-palette {
        display: none;
      }
      /*
        The active side panel floats over the canvas (not the rail), filling the
        body so it's actually usable, and is dismissed via the rail toggle.
      */
      .body app-inspector,
      .body app-regions-panel {
        position: absolute;
        inset: 0 var(--rail-edge) 0 0;
        z-index: 1;
        overflow: auto;
        background: var(--surface, #fff);
      }
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
