import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ButtonDirective } from '../ui/button';
import { Coord } from '../ui/coord';
import { Icon } from '../ui/icon/icon';

/** A single rendered hex in the demo cluster on the canvas frame. */
interface DemoHex {
  readonly q: number;
  readonly r: number;
  readonly cx: number;
  readonly cy: number;
  readonly points: string;
  readonly terrain?: string; // a --terrain-* token, or undefined for Void
  readonly feature?: string; // a marker id placed on the hex
  readonly selected?: boolean;
}

/** Flat-top hex radius (centre → corner) for the demo cluster, in SVG units. */
const HEX_R = 34;

/**
 * The map frame — a static SVG illustration standing in for the real Canvas 2D
 * renderer (ADR-0003). Its feature markers live in a local `<defs>`, not as
 * `app-icon` components: they are drawn *inside* this SVG, and SVG-in-SVG can't
 * cross into an HTML component. The illustration is itself the "SVG in its own
 * component" (ADR-0007). HTML chrome over the frame (zoom, compass) uses the
 * shared icon primitive.
 */
@Component({
  selector: 'app-map-canvas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonDirective, Coord, Icon],
  template: `
    <div class="grid" aria-hidden="true"></div>

    <svg class="map" viewBox="-150 -130 300 260" role="img" aria-label="Hex map preview">
      <!-- Feature markers, drawn inside the map's own SVG namespace. -->
      <defs>
        <symbol
          id="mc-settlement"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linejoin="round"
        >
          <path d="M5 19v-7l7-5 7 5v7z" />
          <path d="M10 19v-4h4v4" />
        </symbol>
        <symbol
          id="mc-peak"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linejoin="round"
        >
          <path d="M3 19 10 6l4 7 2-3 5 9z" />
          <path d="m8.5 9.5 1.5 2.5 1.4-2" />
        </symbol>
        <symbol
          id="mc-ruin"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linejoin="round"
        >
          <path d="M5 20V8l2-2v4l2-2v4l2-2v4l2-2v4l2-2v8z" />
        </symbol>
      </defs>

      @for (h of hexes; track h.q + ',' + h.r) {
        @if (h.terrain) {
          <polygon
            [attr.points]="h.points"
            [attr.fill]="'var(' + h.terrain + ')'"
            stroke="var(--hex-line)"
            stroke-width="1"
            [class.is-selected]="h.selected"
          />
          @if (h.feature) {
            <svg
              [attr.x]="h.cx - 11"
              [attr.y]="h.cy - 11"
              width="22"
              height="22"
              class="feature"
            >
              <use [attr.href]="'#mc-' + h.feature" />
            </svg>
          }
        } @else {
          <polygon
            [attr.points]="h.points"
            fill="transparent"
            stroke="var(--hex-line)"
            stroke-width="1"
            class="void"
          />
        }
      }
    </svg>

    <!-- floating canvas instruments -->
    <div class="readout">
      <app-coord>q 0 · r 0</app-coord>
      <span class="readout-sep">·</span>
      <span class="eyebrow">Forest</span>
    </div>

    <div class="compass" title="North">
      <app-icon name="compass" [size]="40" />
    </div>

    <div class="zoom" role="group" aria-label="Zoom">
      <button type="button" appButton icon size="sm" aria-label="Zoom in">
        <app-icon name="plus" [size]="16" />
      </button>
      <app-coord class="zoom-level">100%</app-coord>
      <button type="button" appButton icon size="sm" aria-label="Zoom out">
        <app-icon name="minus" [size]="16" />
      </button>
      <button type="button" appButton icon size="sm" aria-label="Fit map">
        <app-icon name="fit" [size]="16" />
      </button>
    </div>
  `,
  styles: `
    :host {
      position: relative;
      display: block;
      overflow: hidden;
      background: radial-gradient(
        120% 120% at 50% 0%,
        var(--canvas-bg),
        var(--canvas-mat)
      );
    }
    /* The infinite hex grid, drawn as a themed mask so it tints per theme. */
    .grid {
      position: absolute;
      inset: 0;
      background: var(--hex-line);
      -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='49'%3E%3Cpath d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z'/%3E%3C/svg%3E");
      mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='49'%3E%3Cpath d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z'/%3E%3C/svg%3E");
      -webkit-mask-size: 30px 52.5px;
      mask-size: 30px 52.5px;
      opacity: 0.6;
    }
    .map {
      position: absolute;
      inset: 0;
      margin: auto;
      width: min(76%, 640px);
      height: 100%;
      filter: drop-shadow(0 8px 18px rgba(0, 0, 0, 0.22));
    }
    .map polygon {
      transition: fill var(--dur-base) var(--ease-out);
    }
    .map .is-selected {
      stroke: var(--gold);
      stroke-width: 2.4;
      filter: drop-shadow(0 0 6px var(--gold-soft));
    }
    .void {
      opacity: 0.35;
    }
    .feature {
      color: var(--ink-strong);
      pointer-events: none;
    }
    .readout {
      position: absolute;
      top: var(--space-4);
      left: var(--space-4);
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-1) var(--space-3);
      background: color-mix(in oklab, var(--surface) 86%, transparent);
      border: 1px solid var(--line);
      border-radius: var(--radius-full);
      box-shadow: var(--shadow-1);
      backdrop-filter: blur(4px);
    }
    .readout-sep {
      color: var(--line-strong);
    }
    .compass {
      position: absolute;
      top: var(--space-4);
      right: var(--space-4);
      color: var(--gold);
      opacity: 0.85;
      filter: drop-shadow(var(--shadow-1));
    }
    .zoom {
      position: absolute;
      right: var(--space-4);
      bottom: var(--space-4);
      display: flex;
      align-items: center;
      gap: var(--space-1);
      padding: var(--space-1);
      background: color-mix(in oklab, var(--surface) 88%, transparent);
      border: 1px solid var(--line);
      border-radius: var(--radius-full);
      box-shadow: var(--shadow-2);
      backdrop-filter: blur(4px);
    }
    .zoom-level {
      min-width: 3.4em;
      text-align: center;
    }
  `,
})
export class MapCanvas {
  /** The demo hex cluster painted into the canvas frame. */
  protected readonly hexes: DemoHex[] = this.buildCluster();

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
      '0,0': { terrain: '--terrain-forest', feature: 'settlement', selected: true },
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
