import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { Button } from '../../ui/button';
import { Cartouche } from '../../ui/cartouche';
import { Chip } from '../../ui/chip';
import { Coord } from '../../ui/coord';
import { Eyebrow } from '../../ui/eyebrow';
import { Field } from '../../ui/field';
import { IconButton } from '../../ui/icon-button';
import { Icon } from '../../ui/icon/icon';
import { Input } from '../../ui/input';
import { Kbd } from '../../ui/kbd';
import { Panel } from '../../ui/panel';
import { Swatch } from '../../ui/swatch';
import { Textarea } from '../../ui/textarea';

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
    <main class="max-w-[1080px] mx-auto pt-6 px-6 pb-24 flex flex-col gap-16">
      <header class="guide-top flex justify-between items-center">
        <a appButton variant="ghost" size="sm" routerLink="/"
          >← {{ 'styleguide.backToMap' | transloco }}</a
        >
      </header>

      <!-- Masthead -->
      <section class="hero flex flex-col gap-4 pt-12 pb-6 border-b border-line">
        <span appEyebrow>{{ 'styleguide.eyebrow' | transloco }}</span>
        <h1
          class="text-3xl leading-[1.06]"
          [innerHTML]="'styleguide.heroTitle' | transloco"
        ></h1>
        <p
          class="hero-lede"
          [innerHTML]="'styleguide.heroLede' | transloco"
        ></p>
        <div class="flex flex-wrap gap-2 mt-2">
          <app-chip tone="gold">{{
            'styleguide.fontDisplay' | transloco
          }}</app-chip>
          <app-chip tone="sea">{{
            'styleguide.fontBody' | transloco
          }}</app-chip>
          <app-chip tone="astra">{{
            'styleguide.fontCoord' | transloco
          }}</app-chip>
        </div>
      </section>

      <!-- Colour -->
      <section class="section">
        <h2 class="section-title">
          {{ 'styleguide.paletteSemantic' | transloco }}
        </h2>
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

        <h2 class="section-title">
          {{ 'styleguide.paletteTerrain' | transloco }}
        </h2>
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
              <span
                class="typerow-sample"
                [style.font-size]="'var(' + t.token + ')'"
                >{{ t.sample }}</span
              >
              <span class="typerow-meta"
                ><code>{{ t.token }}</code
                ><span>{{ t.size }}</span></span
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
                <code>p-{{ s }}</code>
                <span class="ramp-bar" [style.width]="'calc(var(--spacing) * ' + s + ')'"></span>
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
            <figcaption appEyebrow>
              {{ 'styleguide.buttons' | transloco }}
            </figcaption>
            <div class="specimen-row">
              <button appButton variant="primary">
                {{ 'styleguide.shareMap' | transloco }}
              </button>
              <button appButton>
                {{ 'styleguide.addRegion' | transloco }}
              </button>
              <button appButton variant="ghost">
                {{ 'common.cancel' | transloco }}
              </button>
              <button appButton danger>
                {{ 'styleguide.clearHex' | transloco }}
              </button>
              <button appButton size="sm">
                {{ 'styleguide.small' | transloco }}
              </button>
            </div>
          </figure>

          <figure class="specimen" appPanel>
            <figcaption appEyebrow>
              {{ 'styleguide.iconButtons' | transloco }}
            </figcaption>
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
                <span
                  appSwatch
                  [style.background]="'var(--color-terrain-forest)'"
                ></span>
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
            <figcaption appEyebrow>
              {{ 'styleguide.chipsCoords' | transloco }}
            </figcaption>
            <div class="specimen-row">
              <app-chip>{{ 'styleguide.chipDefault' | transloco }}</app-chip>
              <app-chip tone="gold">{{
                'styleguide.chipSettlement' | transloco
              }}</app-chip>
              <app-chip tone="sea">{{
                'styleguide.chipEditing' | transloco
              }}</app-chip>
              <app-chip tone="astra">{{
                'styleguide.chipRegion' | transloco
              }}</app-chip>
              <app-coord>q 12 · r −4</app-coord>
              <kbd appKbd>⌘ Z</kbd>
            </div>
          </figure>

          <figure class="specimen" appPanel>
            <figcaption appEyebrow>
              {{ 'styleguide.fields' | transloco }}
            </figcaption>
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
    </main>
  `,
  styles: `
    @reference '#app-styles.css';

    /* Styleguide — layout only; specimens use the primitives and global classes. */

    /* ----- Hero ------------------------------------------------------------- */
    .hero-lede {
      @apply text-md leading-normal text-ink-muted;
      max-width: var(--container-reading);
    }
    .hero-lede code,
    .section-note code,
    figcaption code {
      @apply font-mono text-gold-strong;
      font-size: 0.86em;
    }

    /* ----- Sections --------------------------------------------------------- */
    .section {
      @apply flex flex-col gap-4;
    }
    .section.is-split {
      @apply grid grid-cols-2 gap-12;
    }
    .section-title {
      @apply text-lg pb-2 border-b border-line-faint;
    }
    .section-note {
      @apply -mt-3 text-sm text-ink-muted;
    }

    /* ----- Colour swatches -------------------------------------------------- */
    .swatches {
      @apply grid gap-3;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    }
    .swatchcard {
      @apply flex flex-col gap-2 m-0;
    }
    .swatchcard-chip {
      @apply h-16 rounded-md border border-line-strong shadow-inset;
    }
    .swatchcard figcaption {
      @apply flex flex-col gap-px text-sm;
    }
    .swatchcard code {
      @apply font-mono text-2xs text-ink-faint;
    }

    /* ----- Type ------------------------------------------------------------- */
    .typelist {
      @apply py-2 px-6;
    }
    .typerow {
      @apply flex items-baseline justify-between gap-6 py-3 border-b border-line-faint;
    }
    .typerow:last-child {
      @apply border-b-0;
    }
    .typerow-sample {
      @apply font-display text-ink-strong leading-[1.1] overflow-hidden text-ellipsis whitespace-nowrap;
    }
    .typerow-meta {
      @apply flex gap-3 flex-none font-mono text-2xs text-ink-faint;
    }

    /* ----- Spacing & radii -------------------------------------------------- */
    .ramp {
      @apply flex flex-col gap-3;
    }
    .ramp-row {
      @apply flex items-center gap-4 font-mono text-2xs text-ink-muted;
    }
    .ramp-row code {
      @apply flex-none;
      width: 7ch;
    }
    .ramp-bar {
      @apply h-3.5 rounded-sm;
      background: linear-gradient(90deg, var(--color-gold), var(--color-gold-strong));
    }
    .radii {
      @apply flex flex-wrap gap-4;
    }
    .radiicard {
      @apply flex flex-col items-center gap-2 m-0 font-mono text-2xs text-ink-muted;
    }
    .radiicard-box {
      @apply w-16 h-16 bg-surface-sunken border border-gold;
    }

    /* ----- Component specimens --------------------------------------------- */
    .specimens {
      @apply grid gap-4;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    }
    .specimen {
      @apply flex flex-col gap-4 p-4 m-0;
    }
    .specimen-row {
      @apply flex flex-wrap items-center gap-3;
    }
    .specimen-col {
      @apply flex flex-col gap-3;
    }

    /* ----- Footer ----------------------------------------------------------- */
    .guide-foot {
      @apply flex justify-between items-center pt-6 border-t border-line text-sm text-ink-muted;
    }
    .guide-foot .brand {
      @apply text-md text-gold;
    }
    .guide-foot code {
      @apply font-mono text-2xs;
    }

    @media (max-width: 720px) {
      .section.is-split {
        @apply grid-cols-1;
      }
    }
  `,
})
export class Styleguide {
  protected readonly semantic: SwatchRow[] = [
    { token: '--color-bg', nameKey: 'styleguide.swatch.table' },
    { token: '--color-surface', nameKey: 'styleguide.swatch.paper' },
    {
      token: '--color-surface-raised',
      nameKey: 'styleguide.swatch.pinnedNote',
    },
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
    {
      token: '--color-terrain-mountain',
      nameKey: 'styleguide.swatch.mountains',
    },
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

  protected readonly spacing = [1, 2, 3, 4, 6, 8, 12];

  protected readonly radii = [
    '--radius-sm',
    '--radius-md',
    '--radius-lg',
    '--radius-xl',
  ];
}
