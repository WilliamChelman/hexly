import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { HealthStatus, isHealthy } from '@hexly/domain';
import { ThemeService } from '../core/theme.service';

/** A palette entry — one paintable thing, named in the domain's vocabulary. */
interface Tool {
  readonly id: string;
  readonly label: string;
  readonly hint: string; // keyboard shortcut
  /** A terrain swatch colour token, when this tool paints a Terrain. */
  readonly swatch?: string;
  /** An inline glyph id rendered by the template, for non-terrain tools. */
  readonly glyph?: string;
}

/** A single rendered hex in the demo cluster on the canvas frame. */
interface DemoHex {
  readonly q: number;
  readonly r: number;
  readonly cx: number;
  readonly cy: number;
  readonly points: string;
  readonly terrain?: string; // a --terrain-* token, or undefined for Void
  readonly feature?: string; // a glyph id placed on the hex
  readonly selected?: boolean;
}

/** Flat-top hex radius (centre → corner) for the demo cluster, in SVG units. */
const HEX_R = 34;

@Component({
  selector: 'app-editor-shell',
  imports: [RouterLink],
  templateUrl: './editor-shell.html',
  styleUrl: './editor-shell.css',
})
export class EditorShell implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly themeService = inject(ThemeService);

  protected readonly theme = this.themeService.theme;

  /** The API's reported health, or `null` until the call resolves. */
  protected readonly health = signal<HealthStatus | null>(null);
  /** Set when the `/health` call fails, so the status bar can show a fallback. */
  protected readonly error = signal<string | null>(null);
  protected readonly healthy = computed(() => {
    const status = this.health();
    return status !== null && isHealthy(status);
  });

  /** Which palette tool is currently armed. */
  protected readonly activeTool = signal('forest');

  protected readonly terrainTools: Tool[] = [
    { id: 'grass', label: 'Grassland', hint: '1', swatch: '--terrain-grass' },
    { id: 'forest', label: 'Forest', hint: '2', swatch: '--terrain-forest' },
    { id: 'ocean', label: 'Ocean', hint: '3', swatch: '--terrain-ocean' },
    {
      id: 'mountain',
      label: 'Mountains',
      hint: '4',
      swatch: '--terrain-mountain',
    },
    { id: 'desert', label: 'Desert', hint: '5', swatch: '--terrain-desert' },
  ];

  protected readonly contentTools: Tool[] = [
    { id: 'feature', label: 'Feature', hint: 'F', glyph: 'feature' },
    { id: 'overlay', label: 'Overlay', hint: 'O', glyph: 'overlay' },
    { id: 'region', label: 'Region', hint: 'R', glyph: 'region' },
    { id: 'label', label: 'Label', hint: 'L', glyph: 'label' },
  ];

  /** The demo hex cluster painted into the canvas frame. */
  protected readonly hexes: DemoHex[] = this.buildCluster();

  setTool(id: string): void {
    this.activeTool.set(id);
  }

  ngOnInit(): void {
    this.http.get<HealthStatus>('/health').subscribe({
      next: (status) => this.health.set(status),
      error: () => this.error.set('Could not reach the API.'),
    });
  }

  /**
   * Build a small, hand-arranged cluster of flat-top hexes around the origin
   * so the canvas reads as a real (if frozen) map: terrain washes, a couple of
   * Features, a selected hex, and surrounding Void.
   */
  private buildCluster(): DemoHex[] {
    const painted: Record<
      string,
      { terrain?: string; feature?: string; selected?: boolean }
    > = {
      '0,0': {
        terrain: '--terrain-forest',
        feature: 'settlement',
        selected: true,
      },
      '1,0': { terrain: '--terrain-forest' },
      '1,-1': { terrain: '--terrain-grass' },
      '0,1': { terrain: '--terrain-grass' },
      '2,-1': { terrain: '--terrain-mountain', feature: 'peak' },
      '2,0': { terrain: '--terrain-mountain' },
      '-1,1': { terrain: '--terrain-ocean' },
      '-1,2': { terrain: '--terrain-ocean' },
      '0,2': { terrain: '--terrain-ocean' },
      '-2,1': { terrain: '--terrain-grass' },
      '1,1': { terrain: '--terrain-desert' },
      '2,1': { terrain: '--terrain-desert' },
      '-1,0': { terrain: '--terrain-grass', feature: 'ruin' },
    };

    const hexes: DemoHex[] = [];
    for (let q = -2; q <= 2; q++) {
      for (let r = -2; r <= 2; r++) {
        const cx = HEX_R * 1.5 * q;
        const cy = HEX_R * Math.sqrt(3) * (r + q / 2);
        const cell = painted[`${q},${r}`];
        hexes.push({
          q,
          r,
          cx,
          cy,
          points: this.hexPoints(cx, cy),
          terrain: cell?.terrain,
          feature: cell?.feature,
          selected: cell?.selected,
        });
      }
    }
    return hexes;
  }

  /** SVG polygon points for a flat-top hexagon centred at (cx, cy). */
  private hexPoints(cx: number, cy: number): string {
    const pts: string[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i);
      pts.push(
        `${(cx + HEX_R * Math.cos(a)).toFixed(2)},${(cy + HEX_R * Math.sin(a)).toFixed(2)}`,
      );
    }
    return pts.join(' ');
  }
}
