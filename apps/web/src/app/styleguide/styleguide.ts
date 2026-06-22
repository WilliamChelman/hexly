import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { Button } from '../ui/button';
import { Cartouche } from '../ui/cartouche';
import { Chip } from '../ui/chip';
import { Coord } from '../ui/coord';
import { Eyebrow } from '../ui/eyebrow';
import { Field } from '../ui/field';
import { IconButton } from '../ui/icon-button';
import { SelectIcon } from '../ui/icon/glyphs/select';
import { TerrainIcon } from '../ui/icon/glyphs/terrain';
import { UndoIcon } from '../ui/icon/glyphs/undo';
import { Input } from '../ui/input';
import { Kbd } from '../ui/kbd';
import { Panel } from '../ui/panel';
import { Swatch } from '../ui/swatch';
import { Textarea } from '../ui/textarea';

interface SwatchRow {
  readonly token: string;
  /** A `styleguide.swatch.*` translation key for the role's display name. */
  readonly nameKey: string;
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
    TranslocoPipe,
    Button,
    Cartouche,
    Chip,
    Coord,
    Eyebrow,
    Field,
    Input,
    IconButton,
    SelectIcon,
    TerrainIcon,
    UndoIcon,
    Swatch,
    Kbd,
    Panel,
    Textarea,
  ],
  template: `
    <div class="guide">
      <header class="guide-top">
        <a appButton variant="ghost" size="sm" routerLink="/"
          >← {{ 'styleguide.backToMap' | transloco }}</a
        >
      </header>

      <!-- Masthead -->
      <section class="hero">
        <span appEyebrow>{{ 'styleguide.eyebrow' | transloco }}</span>
        <h1 class="hero-title" [innerHTML]="'styleguide.heroTitle' | transloco"></h1>
        <p class="hero-lede" [innerHTML]="'styleguide.heroLede' | transloco"></p>
        <div class="hero-meta">
          <app-chip tone="gold">{{ 'styleguide.fontDisplay' | transloco }}</app-chip>
          <app-chip tone="sea">{{ 'styleguide.fontBody' | transloco }}</app-chip>
          <app-chip tone="astra">{{ 'styleguide.fontCoord' | transloco }}</app-chip>
        </div>
      </section>

      <!-- Colour -->
      <section class="section">
        <h2 class="section-title">{{ 'styleguide.paletteSemantic' | transloco }}</h2>
        <p class="section-note">{{ 'styleguide.paletteNote' | transloco }}</p>
        <div class="swatches">
          @for (s of semantic; track s.token) {
          <figure class="swatchcard">
            <span
              class="swatchcard-chip"
              [style.background]="'var(' + s.token + ')'"
            ></span>
            <figcaption>
              <strong>{{ s.nameKey | transloco }}</strong>
              <code>{{ s.token }}</code>
            </figcaption>
          </figure>
          }
        </div>

        <h2 class="section-title">{{ 'styleguide.paletteTerrain' | transloco }}</h2>
        <div class="swatches">
          @for (s of terrain; track s.token) {
          <figure class="swatchcard">
            <span
              class="swatchcard-chip"
              [style.background]="'var(' + s.token + ')'"
            ></span>
            <figcaption>
              <strong>{{ s.nameKey | transloco }}</strong>
              <code>{{ s.token }}</code>
            </figcaption>
          </figure>
          }
        </div>
      </section>

      <!-- Type -->
      <section class="section">
        <h2 class="section-title">{{ 'styleguide.typeScale' | transloco }}</h2>
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
          <h2 class="section-title">{{ 'styleguide.spacing' | transloco }}</h2>
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
          <h2 class="section-title">{{ 'styleguide.radii' | transloco }}</h2>
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
        <h2 class="section-title">{{ 'styleguide.components' | transloco }}</h2>
        <div class="specimens">
          <figure class="specimen" appPanel>
            <figcaption appEyebrow>{{ 'styleguide.buttons' | transloco }}</figcaption>
            <div class="specimen-row">
              <button appButton variant="primary">{{ 'styleguide.shareMap' | transloco }}</button>
              <button appButton>{{ 'styleguide.addRegion' | transloco }}</button>
              <button appButton variant="ghost">{{ 'common.cancel' | transloco }}</button>
              <button appButton danger>{{ 'styleguide.clearHex' | transloco }}</button>
              <button appButton size="sm">{{ 'styleguide.small' | transloco }}</button>
            </div>
          </figure>

          <figure class="specimen" appPanel>
            <figcaption appEyebrow>{{ 'styleguide.iconButtons' | transloco }}</figcaption>
            <div class="specimen-row">
              <button
                appIconButton
                toggle
                active
                [title]="'styleguide.iconSelectTitle' | transloco"
                [attr.aria-label]="'styleguide.iconSelectLabel' | transloco"
              >
                <app-icon-select [size]="20" />
              </button>
              <button
                appIconButton
                toggle
                [title]="'styleguide.iconTerrainTitle' | transloco"
                [attr.aria-label]="'styleguide.iconTerrainLabel' | transloco"
              >
                <app-icon-terrain [size]="20" />
              </button>
              <button
                appIconButton
                toggle
                [title]="'styleguide.iconForestTitle' | transloco"
                [attr.aria-label]="'styleguide.iconForestLabel' | transloco"
              >
                <span appSwatch [style.background]="'var(--terrain-forest)'"></span>
              </button>
              <button
                appIconButton
                [title]="'styleguide.iconUndo' | transloco"
                [attr.aria-label]="'styleguide.iconUndo' | transloco"
              >
                <app-icon-undo [size]="20" />
              </button>
            </div>
          </figure>

          <figure class="specimen" appPanel>
            <figcaption appEyebrow>{{ 'styleguide.chipsCoords' | transloco }}</figcaption>
            <div class="specimen-row">
              <app-chip>{{ 'styleguide.chipDefault' | transloco }}</app-chip>
              <app-chip tone="gold">{{ 'styleguide.chipSettlement' | transloco }}</app-chip>
              <app-chip tone="sea">{{ 'styleguide.chipEditing' | transloco }}</app-chip>
              <app-chip tone="astra">{{ 'styleguide.chipRegion' | transloco }}</app-chip>
              <app-coord>q 12 · r −4</app-coord>
              <kbd appKbd>⌘ Z</kbd>
            </div>
          </figure>

          <figure class="specimen" appPanel>
            <figcaption appEyebrow>{{ 'styleguide.fields' | transloco }}</figcaption>
            <div class="specimen-col">
              <label appField [label]="'styleguide.fieldMapName' | transloco">
                <input appInput value="The Reach of Aldermoor" />
              </label>
              <label appField [label]="'styleguide.fieldNote' | transloco">
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
        <span
          >{{ 'styleguide.footerTokens' | transloco }} ·
          <code>apps/web/src/styles</code></span
        >
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
  protected readonly semantic: SwatchRow[] = [
    { token: '--bg', nameKey: 'styleguide.swatch.table' },
    { token: '--surface', nameKey: 'styleguide.swatch.paper' },
    { token: '--surface-raised', nameKey: 'styleguide.swatch.pinnedNote' },
    { token: '--surface-sunken', nameKey: 'styleguide.swatch.well' },
    { token: '--ink', nameKey: 'styleguide.swatch.ink' },
    { token: '--ink-muted', nameKey: 'styleguide.swatch.inkMuted' },
    { token: '--gold', nameKey: 'styleguide.swatch.compassGold' },
    { token: '--sea', nameKey: 'styleguide.swatch.seaAurora' },
    { token: '--astra', nameKey: 'styleguide.swatch.nebula' },
    { token: '--ember', nameKey: 'styleguide.swatch.marginalia' },
    { token: '--positive', nameKey: 'styleguide.swatch.moss' },
    { token: '--line-strong', nameKey: 'styleguide.swatch.drawnRule' },
  ];

  protected readonly terrain: SwatchRow[] = [
    { token: '--terrain-grass', nameKey: 'styleguide.swatch.grassland' },
    { token: '--terrain-forest', nameKey: 'styleguide.swatch.forest' },
    { token: '--terrain-ocean', nameKey: 'styleguide.swatch.ocean' },
    { token: '--terrain-mountain', nameKey: 'styleguide.swatch.mountains' },
    { token: '--terrain-desert', nameKey: 'styleguide.swatch.desert' },
    { token: '--terrain-marsh', nameKey: 'styleguide.swatch.marsh' },
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
