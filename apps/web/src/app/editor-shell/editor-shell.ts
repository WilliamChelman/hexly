import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, EMPTY, filter, map, switchMap } from 'rxjs';
import { TitleService } from '../core/i18n/title.service';
import { EditorSession } from './editor-session';
import { EditorStore } from './editor-store';
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
  host: { class: 'block h-full overflow-hidden' },
  imports: [
    ToolPalette,
    MapCanvas,
    Inspector,
    RegionsPanel,
    EditorRail,
    StatusBar,
  ],
  template: `
    <div class="shell">
      <div class="body relative min-h-0">
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
        <div
          class="right-dock absolute top-3 right-3 bottom-3 flex items-start gap-2 z-[1] pointer-events-none"
        >
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
    .shell {
      display: grid;
      grid-template-rows: 1fr var(--rail-status);
      height: 100%;
    }
    /* The body is the floating-chrome stacking context; the canvas fills it. */
    .body app-map-canvas {
      position: absolute;
      inset: 0;
    }
    /* Tool palette anchored top-left; rail top-right; panel to the rail's left. */
    .body app-tool-palette {
      position: absolute;
      top: var(--spacing-3);
      left: var(--spacing-3);
      max-height: calc(100% - 2 * var(--spacing-3));
      z-index: 1;
    }
    /*
      The right dock floats top-right and lays the panel + rail out as a row (its
      box/layout lives in inline utilities on the element). It spans the body's
      height (top..bottom) so the panel can cap its height and scroll internally
      (story 22); pointer-events pass through its empty area so the canvas stays
      interactive below a short panel — re-enabled per child here.
    */
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
      border: 1px solid var(--color-line);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-2);
    }
  `,
})
export class EditorShell {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly session = inject(EditorSession);
  private readonly title = inject(TitleService);
  /** Drives which view occupies the shared right column (Inspector vs Regions list). */
  protected readonly store = inject(EditorStore);

  constructor() {
    // The editor owns its tab title: push the open map's name so it reads
    // "{map} — Hexly" and tracks loads and renames, and clear it on the way out
    // so a stale name never shadows the next page's title.
    effect(() => this.title.setDocumentName(this.session.current()?.title ?? null));
    inject(DestroyRef).onDestroy(() => this.title.setDocumentName(null));

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
