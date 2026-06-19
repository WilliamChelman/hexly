import { ChangeDetectionStrategy, Component } from '@angular/core';
import { EditorHeader } from './editor-header';
import { ToolPalette } from './tool-palette';
import { MapCanvas } from './map-canvas';
import { Inspector } from './inspector';
import { StatusBar } from './status-bar';

/**
 * The editor's layout orchestrator. It owns no chrome of its own — each region
 * (header, tool palette, canvas, inspector, status bar) is its own component —
 * only the three-row / three-column frame that arranges them. See ADR-0007.
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
export class EditorShell {}
