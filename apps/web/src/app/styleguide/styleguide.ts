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
import { Icon } from '../ui/icon/icon';
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
    Icon,
    Swatch,
    Kbd,
    Panel,
    Textarea,
  ],
  host: { class: 'block' },
  template: `
    <div class="max-w-[1080px] mx-auto pt-5 px-5 pb-9 flex flex-col gap-8">
      <header class="guide-top flex justify-between items-center">
        <a appButton variant="ghost" size="sm" routerLink="/"
          >← {{ 'styleguide.backToMap' | transloco }}</a
        >
      </header>

      <!-- Masthead -->
      <section class="hero flex flex-col gap-4 pt-7 pb-5 border-b border-line">
        <span appEyebrow>{{ 'styleguide.eyebrow' | transloco }}</span>
        <h1 class="text-3xl leading-[1.06]" [innerHTML]="'styleguide.heroTitle' | transloco"></h1>
        <p class="hero-lede" [innerHTML]="'styleguide.heroLede' | transloco"></p>
        <div class="flex flex-wrap gap-2 mt-2">
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
                <app-icon name="select" [size]="20" />
              </button>
              <button
                appIconButton
                toggle
                [title]="'styleguide.iconTerrainTitle' | transloco"
                [attr.aria-label]="'styleguide.iconTerrainLabel' | transloco"
              >
                <app-icon name="terrain" [size]="20" />
              </button>
              <button
                appIconButton
                toggle
                [title]="'styleguide.iconForestTitle' | transloco"
                [attr.aria-label]="'styleguide.iconForestLabel' | transloco"
              >
                <span appSwatch [style.background]="'var(--color-terrain-forest)'"></span>
              </button>
              <button
                appIconButton
                [title]="'styleguide.iconUndo' | transloco"
                [attr.aria-label]="'styleguide.iconUndo' | transloco"
              >
                <app-icon name="undo" [size]="20" />
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

    /* ----- Hero ------------------------------------------------------------- */
    .hero-lede {
      max-width: var(--container-reading);
      font-size: var(--text-md);
      line-height: var(--leading-normal);
      color: var(--color-ink-muted);
    }
    .hero-lede code,
    .section-note code,
    figcaption code {
      font-family: var(--font-mono);
      font-size: 0.86em;
      color: var(--color-gold-strong);
    }

    /* ----- Sections --------------------------------------------------------- */
    .section {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
    }
    .section.is-split {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--spacing-7);
    }
    .section-title {
      font-size: var(--text-lg);
      padding-bottom: var(--spacing-2);
      border-bottom: 1px solid var(--color-line-faint);
    }
    .section-note {
      margin-top: calc(var(--spacing-3) * -1);
      font-size: var(--text-sm);
      color: var(--color-ink-muted);
    }

    /* ----- Colour swatches -------------------------------------------------- */
    .swatches {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: var(--spacing-3);
    }
    .swatchcard {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
      margin: 0;
    }
    .swatchcard-chip {
      height: 64px;
      border-radius: var(--radius-md);
      border: 1px solid var(--color-line-strong);
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
      color: var(--color-ink-faint);
    }

    /* ----- Type ------------------------------------------------------------- */
    .typelist {
      padding: var(--spacing-2) var(--spacing-5);
    }
    .typerow {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--spacing-5);
      padding: var(--spacing-3) 0;
      border-bottom: 1px solid var(--color-line-faint);
    }
    .typerow:last-child {
      border-bottom: 0;
    }
    .typerow-sample {
      font-family: var(--font-display);
      color: var(--color-ink-strong);
      line-height: 1.1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .typerow-meta {
      display: flex;
      gap: var(--spacing-3);
      flex: none;
      font-family: var(--font-mono);
      font-size: var(--text-2xs);
      color: var(--color-ink-faint);
    }

    /* ----- Spacing & radii -------------------------------------------------- */
    .ramp {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-3);
    }
    .ramp-row {
      display: flex;
      align-items: center;
      gap: var(--spacing-4);
      font-family: var(--font-mono);
      font-size: var(--text-2xs);
      color: var(--color-ink-muted);
    }
    .ramp-row code {
      width: 7ch;
      flex: none;
    }
    .ramp-bar {
      height: 14px;
      background: linear-gradient(90deg, var(--color-gold), var(--color-gold-strong));
      border-radius: var(--radius-sm);
    }
    .radii {
      display: flex;
      flex-wrap: wrap;
      gap: var(--spacing-4);
    }
    .radiicard {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--spacing-2);
      margin: 0;
      font-family: var(--font-mono);
      font-size: var(--text-2xs);
      color: var(--color-ink-muted);
    }
    .radiicard-box {
      width: 64px;
      height: 64px;
      background: var(--color-surface-sunken);
      border: 1px solid var(--color-gold);
    }

    /* ----- Component specimens --------------------------------------------- */
    .specimens {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: var(--spacing-4);
    }
    .specimen {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
      padding: var(--spacing-4);
      margin: 0;
    }
    .specimen-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--spacing-3);
    }
    .specimen-col {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-3);
    }

    /* ----- Footer ----------------------------------------------------------- */
    .guide-foot {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: var(--spacing-5);
      border-top: 1px solid var(--color-line);
      font-size: var(--text-sm);
      color: var(--color-ink-muted);
    }
    .guide-foot .brand {
      font-size: var(--text-md);
      color: var(--color-gold);
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
    { token: '--color-bg', nameKey: 'styleguide.swatch.table' },
    { token: '--color-surface', nameKey: 'styleguide.swatch.paper' },
    { token: '--color-surface-raised', nameKey: 'styleguide.swatch.pinnedNote' },
    { token: '--color-surface-sunken', nameKey: 'styleguide.swatch.well' },
    { token: '--color-ink', nameKey: 'styleguide.swatch.ink' },
    { token: '--color-ink-muted', nameKey: 'styleguide.swatch.inkMuted' },
    { token: '--color-gold', nameKey: 'styleguide.swatch.compassGold' },
    { token: '--color-sea', nameKey: 'styleguide.swatch.seaAurora' },
    { token: '--color-astra', nameKey: 'styleguide.swatch.nebula' },
    { token: '--color-ember', nameKey: 'styleguide.swatch.marginalia' },
    { token: '--color-positive', nameKey: 'styleguide.swatch.moss' },
    { token: '--color-line-strong', nameKey: 'styleguide.swatch.drawnRule' },
  ];

  protected readonly terrain: SwatchRow[] = [
    { token: '--color-terrain-grass', nameKey: 'styleguide.swatch.grassland' },
    { token: '--color-terrain-forest', nameKey: 'styleguide.swatch.forest' },
    { token: '--color-terrain-ocean', nameKey: 'styleguide.swatch.ocean' },
    { token: '--color-terrain-mountain', nameKey: 'styleguide.swatch.mountains' },
    { token: '--color-terrain-desert', nameKey: 'styleguide.swatch.desert' },
    { token: '--color-terrain-marsh', nameKey: 'styleguide.swatch.marsh' },
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
    '--spacing-1',
    '--spacing-2',
    '--spacing-3',
    '--spacing-4',
    '--spacing-5',
    '--spacing-6',
    '--spacing-7',
  ];

  protected readonly radii = [
    '--radius-sm',
    '--radius-md',
    '--radius-lg',
    '--radius-xl',
  ];
}
