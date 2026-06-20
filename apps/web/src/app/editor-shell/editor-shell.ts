import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, EMPTY, filter, map, switchMap } from 'rxjs';
import { EditorSession } from './editor-session';
import { EditorHeader } from './editor-header';
import { ToolPalette } from './tool-palette';
import { MapCanvas } from './map-canvas';
import { Inspector } from './inspector';
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
  imports: [EditorHeader, ToolPalette, MapCanvas, Inspector, StatusBar],
  template: `
    <div class="shell">
      <app-editor-header />
      <div class="body">
        <app-tool-palette />
        <app-map-canvas />
        <app-inspector />
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
      grid-template-columns: var(--rail-tools) 1fr var(--rail-inspector);
      min-height: 0;
    }
    /* Narrow viewports: collapse the side rails so the canvas stays usable. */
    @media (max-width: 1080px) {
      .body {
        grid-template-columns: 1fr;
      }
      .body app-tool-palette,
      .body app-inspector {
        display: none;
      }
    }
  `,
})
export class EditorShell {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly session = inject(EditorSession);

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
