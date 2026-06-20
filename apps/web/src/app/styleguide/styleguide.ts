import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ThemeService } from '../core/theme.service';
import { Button } from '../ui/button';
import { Cartouche } from '../ui/cartouche';
import { Chip } from '../ui/chip';
import { Coord } from '../ui/coord';
import { Eyebrow } from '../ui/eyebrow';
import { Field } from '../ui/field';
import { Input } from '../ui/input';
import { Kbd } from '../ui/kbd';
import { Panel } from '../ui/panel';
import { Textarea } from '../ui/textarea';
import { Tool } from '../ui/tool';

interface SwatchRow {
  readonly token: string;
  readonly name: string;
}
interface TypeRow {
  readonly token: string;
  readonly size: string;
  readonly sample: string;
}

/**
 * The living design-system reference. It renders the token layer back to the
 * reader — colours, type, spacing, components — so other UI slices can see
 * exactly what is available and adopt it. It is built only from the primitives
 * and global classes it documents.
 */
@Component({
  selector: 'app-styleguide',
  imports: [
    RouterLink,
    Button,
    Cartouche,
    Chip,
    Coord,
    Eyebrow,
    Field,
    Input,
    Kbd,
    Panel,
    Textarea,
    Tool,
  ],
  template: `
    <div class="guide">
      <header class="guide-top">
        <a appButton variant="ghost" size="sm" routerLink="/">← Back to map</a>
        <button
          type="button"
          appButton
          variant="ghost"
          size="sm"
          (click)="themeService.toggle()"
        >
          {{ theme() === 'dark' ? 'Astral' : 'Parchment' }} · switch
        </button>
      </header>

      <!-- Masthead -->
      <section class="hero">
        <span appEyebrow>Hexly design system</span>
        <h1 class="hero-title">The cartographer’s table,<br />by starlight.</h1>
        <p class="hero-lede">
          One identity told at two hours of the day. <strong>Parchment</strong> is
          the aged sea-chart on the drafting table; <strong>Astral</strong> is the
          same chart under the night sky. Gold is the through-line — compass ink by
          day, constellation lines by night — and the text stays warm
          parchment-cream in both. Everything below is driven by the same CSS
          custom-property layer that <code>apps/web</code> ships.
        </p>
        <div class="hero-meta">
          <app-chip tone="gold">Cinzel · display</app-chip>
          <app-chip tone="sea">Spectral · body</app-chip>
          <app-chip tone="astra">JetBrains Mono · coordinates</app-chip>
        </div>
      </section>

      <!-- Colour -->
      <section class="section">
        <h2 class="section-title">Palette · semantic roles</h2>
        <p class="section-note">
          Slices request a role, never a raw colour. Showing the active theme.
        </p>
        <div class="swatches">
          @for (s of semantic; track s.token) {
          <figure class="swatchcard">
            <span
              class="swatchcard-chip"
              [style.background]="'var(' + s.token + ')'"
            ></span>
            <figcaption>
              <strong>{{ s.name }}</strong>
              <code>{{ s.token }}</code>
            </figcaption>
          </figure>
          }
        </div>

        <h2 class="section-title">Palette · terrain fills</h2>
        <div class="swatches">
          @for (s of terrain; track s.token) {
          <figure class="swatchcard">
            <span
              class="swatchcard-chip"
              [style.background]="'var(' + s.token + ')'"
            ></span>
            <figcaption>
              <strong>{{ s.name }}</strong>
              <code>{{ s.token }}</code>
            </figcaption>
          </figure>
          }
        </div>
      </section>

      <!-- Type -->
      <section class="section">
        <h2 class="section-title">Type scale</h2>
        <div class="typelist" appPanel>
          @for (t of typeScale; track t.token) {
          <div class="typerow">
            <span class="typerow-sample" [style.font-size]="'var(' + t.token + ')'"
              >{{ t.sample }}</span
            >
            <span class="typerow-meta"
              ><code>{{ t.token }}</code><span>{{ t.size }}</span></span
            >
          </div>
          }
        </div>
      </section>

      <!-- Spacing & radii -->
      <section class="section is-split">
        <div>
          <h2 class="section-title">Spacing</h2>
          <div class="ramp">
            @for (s of spacing; track s) {
            <div class="ramp-row">
              <code>{{ s }}</code>
              <span class="ramp-bar" [style.width]="'var(' + s + ')'"></span>
            </div>
            }
          </div>
        </div>
        <div>
          <h2 class="section-title">Radii</h2>
          <div class="radii">
            @for (r of radii; track r) {
            <figure class="radiicard">
              <span
                class="radiicard-box"
                [style.border-radius]="'var(' + r + ')'"
              ></span>
              <code>{{ r }}</code>
            </figure>
            }
          </div>
        </div>
      </section>

      <!-- Components -->
      <section class="section">
        <h2 class="section-title">Components</h2>
        <div class="specimens">
          <figure class="specimen" appPanel>
            <figcaption appEyebrow>Buttons</figcaption>
            <div class="specimen-row">
              <button appButton variant="primary">Share map</button>
              <button appButton>Add region</button>
              <button appButton variant="ghost">Cancel</button>
              <button appButton danger>Clear hex</button>
              <button appButton size="sm">Small</button>
            </div>
          </figure>

          <figure class="specimen" appPanel>
            <figcaption appEyebrow>Tools</figcaption>
            <div class="specimen-col">
              <button
                appTool
                label="Forest"
                hint="2"
                swatch="--terrain-forest"
                active
                aria-label="Forest"
              ></button>
              <button
                appTool
                label="Ocean"
                hint="3"
                swatch="--terrain-ocean"
                aria-label="Ocean"
              ></button>
            </div>
          </figure>

          <figure class="specimen" appPanel>
            <figcaption appEyebrow>Chips & coordinates</figcaption>
            <div class="specimen-row">
              <app-chip>Default</app-chip>
              <app-chip tone="gold">Settlement</app-chip>
              <app-chip tone="sea">Editing</app-chip>
              <app-chip tone="astra">Region</app-chip>
              <app-coord>q 12 · r −4</app-coord>
              <kbd appKbd>⌘ Z</kbd>
            </div>
          </figure>

          <figure class="specimen" appPanel>
            <figcaption appEyebrow>Fields</figcaption>
            <div class="specimen-col">
              <label appField label="Map name">
                <input appInput value="The Reach of Aldermoor" />
              </label>
              <label appField label="Note">
                <textarea appTextarea>
A walled town where the forest road meets the river ford.</textarea
                >
              </label>
            </div>
          </figure>
        </div>
      </section>

      <footer class="guide-foot">
        <span class="brand" appCartouche>Hexly</span>
        <span>Design tokens · <code>apps/web/src/styles</code></span>
      </footer>
    </div>
  `,
  styles: `
    /* Styleguide — layout only; specimens use the primitives and global classes. */
    :host {
      display: block;
    }

    .guide {
      max-width: 1080px;
      margin: 0 auto;
      padding: var(--space-5) var(--space-5) var(--space-9);
      display: flex;
      flex-direction: column;
      gap: var(--space-8);
    }

    .guide-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    /* ----- Hero ------------------------------------------------------------- */
    .hero {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      padding: var(--space-7) 0 var(--space-5);
      border-bottom: 1px solid var(--line);
    }
    .hero-title {
      font-size: var(--text-3xl);
      line-height: 1.06;
    }
    .hero-lede {
      max-width: var(--container-reading);
      font-size: var(--text-md);
      line-height: var(--leading-normal);
      color: var(--ink-muted);
    }
    .hero-lede code,
    .section-note code,
    figcaption code {
      font-family: var(--font-mono);
      font-size: 0.86em;
      color: var(--gold-strong);
    }
    .hero-meta {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      margin-top: var(--space-2);
    }

    /* ----- Sections --------------------------------------------------------- */
    .section {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .section.is-split {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--space-7);
    }
    .section-title {
      font-size: var(--text-lg);
      padding-bottom: var(--space-2);
      border-bottom: 1px solid var(--line-faint);
    }
    .section-note {
      margin-top: calc(var(--space-3) * -1);
      font-size: var(--text-sm);
      color: var(--ink-muted);
    }

    /* ----- Colour swatches -------------------------------------------------- */
    .swatches {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: var(--space-3);
    }
    .swatchcard {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      margin: 0;
    }
    .swatchcard-chip {
      height: 64px;
      border-radius: var(--radius-md);
      border: 1px solid var(--line-strong);
      box-shadow: var(--shadow-inset);
    }
    .swatchcard figcaption {
      display: flex;
      flex-direction: column;
      gap: 1px;
      font-size: var(--text-sm);
    }
    .swatchcard code {
      font-family: var(--font-mono);
      font-size: var(--text-2xs);
      color: var(--ink-faint);
    }

    /* ----- Type ------------------------------------------------------------- */
    .typelist {
      padding: var(--space-2) var(--space-5);
    }
    .typerow {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--space-5);
      padding: var(--space-3) 0;
      border-bottom: 1px solid var(--line-faint);
    }
    .typerow:last-child {
      border-bottom: 0;
    }
    .typerow-sample {
      font-family: var(--font-display);
      color: var(--ink-strong);
      line-height: 1.1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .typerow-meta {
      display: flex;
      gap: var(--space-3);
      flex: none;
      font-family: var(--font-mono);
      font-size: var(--text-2xs);
      color: var(--ink-faint);
    }

    /* ----- Spacing & radii -------------------------------------------------- */
    .ramp {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
    .ramp-row {
      display: flex;
      align-items: center;
      gap: var(--space-4);
      font-family: var(--font-mono);
      font-size: var(--text-2xs);
      color: var(--ink-muted);
    }
    .ramp-row code {
      width: 7ch;
      flex: none;
    }
    .ramp-bar {
      height: 14px;
      background: linear-gradient(90deg, var(--gold), var(--gold-strong));
      border-radius: var(--radius-sm);
    }
    .radii {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-4);
    }
    .radiicard {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-2);
      margin: 0;
      font-family: var(--font-mono);
      font-size: var(--text-2xs);
      color: var(--ink-muted);
    }
    .radiicard-box {
      width: 64px;
      height: 64px;
      background: var(--surface-sunken);
      border: 1px solid var(--gold);
    }

    /* ----- Component specimens --------------------------------------------- */
    .specimens {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: var(--space-4);
    }
    .specimen {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      padding: var(--space-4);
      margin: 0;
    }
    .specimen-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-3);
    }
    .specimen-col {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }

    /* ----- Footer ----------------------------------------------------------- */
    .guide-foot {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: var(--space-5);
      border-top: 1px solid var(--line);
      font-size: var(--text-sm);
      color: var(--ink-muted);
    }
    .guide-foot .brand {
      font-size: var(--text-md);
      color: var(--gold);
    }
    .guide-foot code {
      font-family: var(--font-mono);
      font-size: var(--text-2xs);
    }

    @media (max-width: 720px) {
      .section.is-split {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class Styleguide {
  protected readonly themeService = inject(ThemeService);
  protected readonly theme = this.themeService.theme;

  protected readonly semantic: SwatchRow[] = [
    { token: '--bg', name: 'Table' },
    { token: '--surface', name: 'Paper' },
    { token: '--surface-raised', name: 'Pinned note' },
    { token: '--surface-sunken', name: 'Well' },
    { token: '--ink', name: 'Ink' },
    { token: '--ink-muted', name: 'Ink muted' },
    { token: '--gold', name: 'Compass gold' },
    { token: '--sea', name: 'Sea / aurora' },
    { token: '--astra', name: 'Nebula' },
    { token: '--ember', name: 'Marginalia' },
    { token: '--positive', name: 'Moss' },
    { token: '--line-strong', name: 'Drawn rule' },
  ];

  protected readonly terrain: SwatchRow[] = [
    { token: '--terrain-grass', name: 'Grassland' },
    { token: '--terrain-forest', name: 'Forest' },
    { token: '--terrain-ocean', name: 'Ocean' },
    { token: '--terrain-mountain', name: 'Mountains' },
    { token: '--terrain-desert', name: 'Desert' },
    { token: '--terrain-marsh', name: 'Marsh' },
  ];

  protected readonly typeScale: TypeRow[] = [
    { token: '--text-3xl', size: '41px', sample: 'Worlds, mapped' },
    { token: '--text-2xl', size: '33px', sample: 'The Reach of Aldermoor' },
    { token: '--text-xl', size: '26px', sample: 'A cartographer’s table' },
    { token: '--text-lg', size: '21px', sample: 'Paint terrain & features' },
    {
      token: '--text-md',
      size: '17px',
      sample: 'Notes ride along in the side panel',
    },
    {
      token: '--text-base',
      size: '15px',
      sample: 'The default reading size for body copy.',
    },
    {
      token: '--text-sm',
      size: '13px',
      sample: 'Panel and control text sits here.',
    },
    {
      token: '--text-2xs',
      size: '11px',
      sample: 'Coordinate chips and micro-labels.',
    },
  ];

  protected readonly spacing = [
    '--space-1',
    '--space-2',
    '--space-3',
    '--space-4',
    '--space-5',
    '--space-6',
    '--space-7',
  ];

  protected readonly radii = [
    '--radius-sm',
    '--radius-md',
    '--radius-lg',
    '--radius-xl',
  ];
}
