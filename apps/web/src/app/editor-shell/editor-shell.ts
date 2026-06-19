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
  template: `
    <!-- Inline icon sprite: characterful line glyphs drawn in currentColor. -->
    <svg aria-hidden="true" width="0" height="0" style="position: absolute">
      <defs>
        <symbol id="g-logo" viewBox="0 0 24 24">
          <path
            d="M12 2.2 20.5 7v10L12 21.8 3.5 17V7z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linejoin="round"
          />
          <path
            d="M12 7.4 16.2 9.9v4.2L12 16.6 7.8 14.1V9.9z"
            fill="currentColor"
            opacity=".5"
          />
        </symbol>
        <symbol
          id="g-sun"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
        >
          <circle cx="12" cy="12" r="4" />
          <path
            d="M12 2.5v2M12 19.5v2M4.5 12h-2M21.5 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M18.4 5.6l1.4-1.4M4.2 19.8l1.4-1.4"
          />
        </symbol>
        <symbol id="g-moon" viewBox="0 0 24 24">
          <path
            d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linejoin="round"
          />
          <circle cx="15.5" cy="7.5" r=".9" fill="currentColor" />
          <circle cx="18" cy="11" r=".6" fill="currentColor" />
        </symbol>
        <symbol
          id="g-share"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="6" cy="12" r="2.4" />
          <circle cx="18" cy="6" r="2.4" />
          <circle cx="18" cy="18" r="2.4" />
          <path d="m8.1 10.8 7.8-3.6M8.1 13.2l7.8 3.6" />
        </symbol>
        <symbol
          id="g-settlement"
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
          id="g-peak"
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
          id="g-ruin"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linejoin="round"
        >
          <path d="M5 20V8l2-2v4l2-2v4l2-2v4l2-2v4l2-2v8z" />
        </symbol>
        <symbol
          id="g-feature"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linejoin="round"
        >
          <path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4z" />
        </symbol>
        <symbol
          id="g-overlay"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
        >
          <path
            d="M3 8c3 0 3 3 6 3s3-3 6-3 3 3 6 3M3 15c3 0 3 3 6 3s3-3 6-3 3 3 6 3"
          />
        </symbol>
        <symbol
          id="g-region"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linejoin="round"
          stroke-dasharray="3 2.5"
        >
          <path d="M5 7c4-3 9-2 12 1s2 8-2 10-11 1-12-4 2-4 2-7z" />
        </symbol>
        <symbol
          id="g-label"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
        >
          <path d="M6 6h12M12 6v12M9.5 18h5" />
        </symbol>
        <symbol
          id="g-compass"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.3"
        >
          <circle cx="12" cy="12" r="9" />
          <path
            d="m12 4 2 8 8 2-8 2-2 8-2-8-8-2 8-2z"
            fill="currentColor"
            stroke="none"
            opacity=".85"
          />
        </symbol>
        <symbol
          id="g-plus"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
        >
          <path d="M12 6v12M6 12h12" />
        </symbol>
        <symbol
          id="g-minus"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
        >
          <path d="M6 12h12" />
        </symbol>
        <symbol
          id="g-fit"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M5 9V5h4M19 9V5h-4M5 15v4h4M19 15v4h-4" />
        </symbol>
      </defs>
    </svg>

    <div class="shell">
      <!-- ===== Header chrome ============================================== -->
      <header class="shell__header">
        <div class="brand">
          <span class="brand__mark"
            ><svg width="26" height="26"><use href="#g-logo" /></svg
          ></span>
          <span class="brand__name cartouche">Hexly</span>
        </div>

        <div class="titlebar">
          <span class="eyebrow">Hex map</span>
          <span class="titlebar__name">The Reach of Aldermoor</span>
          <span class="chip chip--sea">Editing</span>
        </div>

        <div class="shell__header-actions">
          <a class="btn btn--ghost btn--sm" routerLink="/styleguide"
            >Design system</a
          >
          <button
            type="button"
            class="btn btn--ghost btn--icon"
            (click)="themeService.toggle()"
            [attr.aria-label]="theme() === 'dark' ? 'Switch to parchment theme' : 'Switch to astral theme'"
            [title]="theme() === 'dark' ? 'Parchment (light)' : 'Astral (dark)'"
          >
            <svg width="20" height="20">
              <use [attr.href]="theme() === 'dark' ? '#g-sun' : '#g-moon'" />
            </svg>
          </button>
          <button type="button" class="btn btn--primary btn--sm">
            <svg width="16" height="16"><use href="#g-share" /></svg>
            Share
          </button>
          <span class="avatar" title="Owner">WC</span>
        </div>
      </header>

      <div class="shell__body">
        <!-- ===== Left tool palette ======================================= -->
        <aside class="tools" aria-label="Map tools">
          <section class="tools__group">
            <h2 class="eyebrow tools__heading">Terrain</h2>
            <div class="tools__list" role="group" aria-label="Terrain">
              @for (t of terrainTools; track t.id) {
              <button
                type="button"
                class="tool"
                [class.is-active]="activeTool() === t.id"
                [attr.aria-pressed]="activeTool() === t.id"
                (click)="setTool(t.id)"
              >
                <span
                  class="swatch"
                  [style.background]="'var(' + t.swatch + ')'"
                ></span>
                <span class="tool__label">{{ t.label }}</span>
                <kbd class="kbd">{{ t.hint }}</kbd>
              </button>
              }
            </div>
          </section>

          <hr class="rule" />

          <section class="tools__group">
            <h2 class="eyebrow tools__heading">Content</h2>
            <div class="tools__list" role="group" aria-label="Content">
              @for (t of contentTools; track t.id) {
              <button
                type="button"
                class="tool"
                [class.is-active]="activeTool() === t.id"
                [attr.aria-pressed]="activeTool() === t.id"
                (click)="setTool(t.id)"
              >
                <span class="tool__glyph"
                  ><svg width="18" height="18">
                    <use [attr.href]="'#g-' + t.glyph" /></svg
                ></span>
                <span class="tool__label">{{ t.label }}</span>
                <kbd class="kbd">{{ t.hint }}</kbd>
              </button>
              }
            </div>
          </section>

          <div class="tools__spacer"></div>

          <section class="tools__group tools__layers panel panel--raised">
            <h2 class="eyebrow">Regions</h2>
            <ul class="layers">
              <li>
                <span class="swatch" style="background: #7c9b86"></span>The
                Whisperwood
              </li>
              <li>
                <span class="swatch" style="background: #b08a4e"></span>Aldermoor
                Reach
              </li>
              <li>
                <span class="swatch" style="background: #6f7fae"></span>The Drowned
                Coast
              </li>
            </ul>
          </section>
        </aside>

        <!-- ===== Canvas frame — the infinite hex plane =================== -->
        <main class="canvas" aria-label="Map canvas">
          <div class="canvas__grid" aria-hidden="true"></div>

          <svg
            class="canvas__map"
            viewBox="-150 -130 300 260"
            role="img"
            aria-label="Hex map preview"
          >
            @for (h of hexes; track h.q + ',' + h.r) { @if (h.terrain) {
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
              class="canvas__feature"
            >
              <use [attr.href]="'#g-' + h.feature" />
            </svg>
            } } @else {
            <polygon
              [attr.points]="h.points"
              fill="transparent"
              stroke="var(--hex-line)"
              stroke-width="1"
              class="canvas__void"
            />
            } }
          </svg>

          <!-- floating canvas instruments -->
          <div class="canvas__readout">
            <span class="coord">q 0 · r 0</span>
            <span class="canvas__readout-sep">·</span>
            <span class="eyebrow">Forest</span>
          </div>

          <div class="compass" title="North">
            <svg width="40" height="40"><use href="#g-compass" /></svg>
          </div>

          <div class="zoom" role="group" aria-label="Zoom">
            <button
              type="button"
              class="btn btn--icon btn--sm"
              aria-label="Zoom in"
            >
              <svg width="16" height="16"><use href="#g-plus" /></svg>
            </button>
            <span class="zoom__level coord">100%</span>
            <button
              type="button"
              class="btn btn--icon btn--sm"
              aria-label="Zoom out"
            >
              <svg width="16" height="16"><use href="#g-minus" /></svg>
            </button>
            <button
              type="button"
              class="btn btn--icon btn--sm"
              aria-label="Fit map"
            >
              <svg width="16" height="16"><use href="#g-fit" /></svg>
            </button>
          </div>
        </main>

        <!-- ===== Right inspector — the selected hex's Note =============== -->
        <aside class="inspector" aria-label="Selection">
          <header class="inspector__head">
            <span class="eyebrow">Selected hex</span>
            <span class="coord">q 0 · r 0</span>
          </header>

          <div class="inspector__title">
            <span class="tool__glyph"
              ><svg width="18" height="18"><use href="#g-settlement" /></svg
            ></span>
            <div>
              <h3 class="inspector__name">Caer Aldermoor</h3>
              <span class="chip chip--gold">Settlement</span>
            </div>
          </div>

          <div class="field">
            <span class="field__label">Terrain</span>
            <div class="inspector__row">
              <span class="swatch" style="background: var(--terrain-forest)"></span>
              <span>Forest</span>
            </div>
          </div>

          <div class="field">
            <span class="field__label">Regions</span>
            <div class="inspector__chips">
              <span class="chip"
                ><span
                  class="swatch"
                  style="background: #7c9b86; width: 11px; height: 11px"
                ></span
                >The Whisperwood</span
              >
              <span class="chip"
                ><span
                  class="swatch"
                  style="background: #b08a4e; width: 11px; height: 11px"
                ></span
                >Aldermoor Reach</span
              >
            </div>
          </div>

          <div class="field inspector__note">
            <span class="field__label">Note</span>
            <p>
              A walled town where the forest road meets the river ford. The
              <em>Lanternwrights' Guild</em> keeps the old beacon lit — sailors on
              the Drowned Coast still steer by it on clear nights.
            </p>
          </div>

          <div class="inspector__actions">
            <button type="button" class="btn btn--sm" style="flex: 1">
              Edit note
            </button>
            <button type="button" class="btn btn--ghost btn--sm btn--danger">
              Clear hex
            </button>
          </div>
        </aside>
      </div>

      <!-- ===== Status bar ================================================ -->
      <footer class="shell__status">
        <span class="status__item" data-testid="health">
          @if (health(); as status) {
          <span class="dot" [class.dot--positive]="healthy()"></span>
          API {{ status.status }} · {{ status.service }} } @else if (error(); as
          message) {
          <span class="dot"></span>{{ message }} } @else {
          <span class="dot"></span>Connecting… }
        </span>
        <span class="status__spacer"></span>
        <span class="status__item"><span class="coord">q 0 · r 0</span></span>
        <span class="status__item">13 hexes</span>
        <span class="status__item">Zoom 100%</span>
        <span class="status__item cartouche">Astral / Parchment</span>
      </footer>
    </div>
  `,
  styles: `
    /* Editor shell — layout only; the look comes from the global token layer. */
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

    /* ===== Header ============================================================ */
    .shell__header {
      display: flex;
      align-items: center;
      gap: var(--space-5);
      padding: 0 var(--space-4);
      background: var(--surface);
      border-bottom: 1px solid var(--line-strong);
      box-shadow: var(--shadow-1);
    }

    .brand {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .brand__mark {
      display: grid;
      place-items: center;
      color: var(--gold);
    }
    .brand__name {
      font-size: var(--text-lg);
      color: var(--ink-strong);
    }

    .titlebar {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding-left: var(--space-5);
      border-left: 1px solid var(--line);
    }
    .titlebar__name {
      font-family: var(--font-display);
      font-size: var(--text-md);
      color: var(--ink);
    }

    .shell__header-actions {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      margin-left: auto;
    }
    .avatar {
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      font-family: var(--font-mono);
      font-size: var(--text-2xs);
      color: var(--on-gold);
      background: linear-gradient(140deg, var(--gold), var(--gold-strong));
      border-radius: var(--radius-full);
      box-shadow: var(--shadow-1);
    }

    /* ===== Body — tools | canvas | inspector ================================ */
    .shell__body {
      display: grid;
      grid-template-columns: var(--rail-tools) 1fr var(--rail-inspector);
      min-height: 0;
    }

    /* ----- Tool palette ----------------------------------------------------- */
    .tools {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      padding: var(--space-4);
      overflow-y: auto;
      background: var(--bg-deep);
      border-right: 1px solid var(--line-strong);
    }
    .tools__group {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }
    .tools__heading {
      padding: 0 var(--space-2);
    }
    .tools__list {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .tools__spacer {
      flex: 1;
    }
    .tools__layers {
      gap: var(--space-3);
      padding: var(--space-3) var(--space-4);
    }
    .layers {
      list-style: none;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      font-size: var(--text-sm);
      color: var(--ink-muted);
    }
    .layers li {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }

    /* ----- Canvas frame ----------------------------------------------------- */
    .canvas {
      position: relative;
      overflow: hidden;
      background: radial-gradient(
        120% 120% at 50% 0%,
        var(--canvas-bg),
        var(--canvas-mat)
      );
    }
    /* The infinite hex grid, drawn as a themed mask so it tints per theme. */
    .canvas__grid {
      position: absolute;
      inset: 0;
      background: var(--hex-line);
      -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='49'%3E%3Cpath d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z'/%3E%3C/svg%3E");
      mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='49'%3E%3Cpath d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z'/%3E%3C/svg%3E");
      -webkit-mask-size: 30px 52.5px;
      mask-size: 30px 52.5px;
      opacity: 0.6;
    }
    .canvas__map {
      position: absolute;
      inset: 0;
      margin: auto;
      width: min(76%, 640px);
      height: 100%;
      filter: drop-shadow(0 8px 18px rgba(0, 0, 0, 0.22));
    }
    .canvas__map polygon {
      transition: fill var(--dur-base) var(--ease-out);
    }
    .canvas__map .is-selected {
      stroke: var(--gold);
      stroke-width: 2.4;
      filter: drop-shadow(0 0 6px var(--gold-soft));
    }
    .canvas__void {
      opacity: 0.35;
    }
    .canvas__feature {
      color: var(--ink-strong);
      pointer-events: none;
    }

    /* Floating canvas instruments */
    .canvas__readout {
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
    .canvas__readout-sep {
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
    .zoom__level {
      min-width: 3.4em;
      text-align: center;
    }

    /* ----- Inspector -------------------------------------------------------- */
    .inspector {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      padding: var(--space-4);
      overflow-y: auto;
      background: var(--surface);
      border-left: 1px solid var(--line-strong);
    }
    .inspector__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .inspector__title {
      display: flex;
      gap: var(--space-3);
      align-items: center;
    }
    .inspector__title > div {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
      align-items: flex-start;
    }
    .inspector__name {
      font-size: var(--text-md);
    }
    .inspector__row {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      font-size: var(--text-sm);
    }
    .inspector__chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
    .inspector__note p {
      font-size: var(--text-sm);
      line-height: var(--leading-normal);
      color: var(--ink);
    }
    .inspector__actions {
      display: flex;
      gap: var(--space-2);
      margin-top: auto;
      padding-top: var(--space-2);
    }

    /* ===== Status bar ======================================================= */
    .shell__status {
      display: flex;
      align-items: center;
      gap: var(--space-4);
      padding: 0 var(--space-4);
      font-size: var(--text-2xs);
      color: var(--ink-muted);
      background: var(--surface);
      border-top: 1px solid var(--line-strong);
    }
    .status__item {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      white-space: nowrap;
    }
    .status__spacer {
      flex: 1;
    }

    /* Narrow viewports: collapse the side rails so the canvas stays usable. */
    @media (max-width: 1080px) {
      .shell__body {
        grid-template-columns: 1fr;
      }
      .tools,
      .inspector {
        display: none;
      }
    }
  `,
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
