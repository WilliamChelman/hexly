import { Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  ButtonComponent,
  ButtonGroupComponent,
  CartoucheComponent,
  ChipComponent,
  ChipTone,
  CoordComponent,
  DialogComponent,
  DotComponent,
  EyebrowComponent,
  FieldComponent,
  IconButtonComponent,
  IconComponent,
  IconName,
  InputComponent,
  KbdComponent,
  ListboxOptionComponent,
  PageHeaderComponent,
  PanelComponent,
  RuleComponent,
  SelectComponent,
  SwatchComponent,
  TextareaComponent,
} from '@hexly/web-ui';
import { DesignToken } from '@hexly/web-styles';

// Each `token` reaches the template spliced into `var(…)`, which the lint rule cannot see (ADR-0075).
interface SwatchRow {
  readonly token: DesignToken;
  /** A `styleguide.swatch.*` translation key for the role's display name. */
  readonly nameKey: string;
}
interface TypeRow {
  readonly token: DesignToken;
  readonly size: string;
  readonly sample: string;
}

/** The living design-system reference: renders the token layer — colours, type, spacing, components. */
@Component({
  selector: 'app-styleguide',
  imports: [
    RouterLink,
    TranslocoPipe,
    ButtonComponent,
    ButtonGroupComponent,
    CartoucheComponent,
    ChipComponent,
    CoordComponent,
    DialogComponent,
    DotComponent,
    SelectComponent,
    EyebrowComponent,
    FieldComponent,
    InputComponent,
    IconButtonComponent,
    IconComponent,
    ListboxOptionComponent,
    PageHeaderComponent,
    RuleComponent,
    SwatchComponent,
    KbdComponent,
    PanelComponent,
    TextareaComponent,
  ],
  host: { class: 'block' },
  template: `
    <main class="max-w-[1080px] mx-auto pt-6 px-6 pb-24 flex flex-col gap-16">
      <header class="guide-top flex justify-between items-center">
        <a appButton variant="ghost" size="sm" routerLink="/">← {{ 'styleguide.backToWorlds' | transloco }}</a>
      </header>

      <section class="hero flex flex-col gap-4 pt-12 pb-6 border-b border-line">
        <span appEyebrow>{{ 'styleguide.eyebrow' | transloco }}</span>
        <h1 class="text-3xl leading-[1.06]" [innerHTML]="'styleguide.heroTitle' | transloco"></h1>
        <p class="hero-lede" [innerHTML]="'styleguide.heroLede' | transloco"></p>
        <div class="flex flex-wrap gap-2 mt-2">
          <app-chip tone="accent">{{ 'styleguide.fontDisplay' | transloco }}</app-chip>
          <app-chip tone="tone-3">{{ 'styleguide.fontBody' | transloco }}</app-chip>
          <app-chip tone="tone-7">{{ 'styleguide.fontCoord' | transloco }}</app-chip>
        </div>
      </section>

      <section class="section">
        <h2 class="section-title">
          {{ 'styleguide.paletteSemantic' | transloco }}
        </h2>
        <p class="section-note">{{ 'styleguide.paletteNote' | transloco }}</p>
        <div class="swatches">
          @for (s of semantic; track s.token) {
            <figure class="swatchcard">
              <span class="swatchcard-chip" [style.background]="'var(' + s.token + ')'"></span>
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
              <span class="swatchcard-chip" [style.background]="'var(' + s.token + ')'"></span>
              <figcaption>
                <strong>{{ s.nameKey | transloco }}</strong>
                <code>{{ s.token }}</code>
              </figcaption>
            </figure>
          }
        </div>
      </section>

      <section class="section">
        <h2 class="section-title">{{ 'styleguide.typeScale' | transloco }}</h2>
        <div class="typelist" appPanel>
          @for (t of typeScale; track t.token) {
            <div class="typerow">
              <span class="typerow-sample" [style.font-size]="'var(' + t.token + ')'">{{ t.sample }}</span>
              <span class="typerow-meta"
                ><code>{{ t.token }}</code
                ><span>{{ t.size }}</span></span
              >
            </div>
          }
        </div>
      </section>

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
                <span class="radiicard-box" [style.border-radius]="'var(' + r + ')'"></span>
                <code>{{ r }}</code>
              </figure>
            }
          </div>
        </div>
      </section>

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
            </div>
            <div class="specimen-row">
              <button appButton size="sm">
                {{ 'styleguide.small' | transloco }}
              </button>
              <button appButton variant="primary" size="sm">
                {{ 'styleguide.smallPrimary' | transloco }}
              </button>
              <button appButton active>
                {{ 'styleguide.activeState' | transloco }}
              </button>
              <button appButton variant="ghost" danger>
                {{ 'styleguide.ghostDanger' | transloco }}
              </button>
              <button appButton icon [attr.aria-label]="'styleguide.addRegion' | transloco">
                <app-icon name="plus" [size]="18" />
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
                <span appSwatch [style.background]="'var(--color-terrain-forest)'"></span>
              </button>
              <button
                appIconButton
                [title]="'styleguide.iconUndo' | transloco"
                [attr.aria-label]="'styleguide.iconUndo' | transloco"
              >
                <app-icon name="undo" [size]="20" />
              </button>
              <button
                appIconButton
                size="sm"
                [title]="'styleguide.iconSettings' | transloco"
                [attr.aria-label]="'styleguide.iconSettings' | transloco"
              >
                <app-icon name="settings" [size]="16" />
              </button>
            </div>
          </figure>

          <figure class="specimen" appPanel>
            <figcaption appEyebrow>
              {{ 'styleguide.chipsCoords' | transloco }}
            </figcaption>
            <div class="specimen-row">
              <app-chip>{{ 'styleguide.chipDefault' | transloco }}</app-chip>
              <app-chip tone="accent">{{ 'styleguide.chipSettlement' | transloco }}</app-chip>
              <app-coord>q 12 · r −4</app-coord>
              <kbd appKbd>⌘ Z</kbd>
            </div>
            <!-- Side by side, with glyphs: mutual distinguishability is all the set claims, so a row is
                 the only honest way to read it (ADR-0075). -->
            <div class="specimen-row">
              @for (row of tones; track row.tone) {
                <app-chip [tone]="row.tone">
                  <app-icon [name]="row.icon" [size]="12" />
                  {{ row.tone }}
                </app-chip>
              }
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
                <textarea appTextarea>A walled town where the forest road meets the river ford.</textarea>
              </label>
              <label appField [label]="'styleguide.fieldTerrain' | transloco">
                <select appSelect>
                  <option>Grassland</option>
                  <option selected>Whisperwood</option>
                  <option>Mountains</option>
                  <option>Ocean</option>
                </select>
              </label>
            </div>
          </figure>

          <figure class="specimen" appPanel>
            <figcaption appEyebrow>
              {{ 'styleguide.buttonGroup' | transloco }}
            </figcaption>
            <div class="specimen-row">
              <div appButtonGroup [attr.aria-label]="'styleguide.viewLabel' | transloco">
                <button appButton variant="ghost" size="sm" active aria-pressed="true">
                  {{ 'styleguide.viewMap' | transloco }}
                </button>
                <button appButton variant="ghost" size="sm" aria-pressed="false">
                  {{ 'styleguide.viewNote' | transloco }}
                </button>
                <button appButton variant="ghost" size="sm" aria-pressed="false">
                  {{ 'styleguide.viewGraph' | transloco }}
                </button>
              </div>
            </div>
          </figure>

          <figure class="specimen" appPanel>
            <figcaption appEyebrow>
              {{ 'styleguide.eyebrows' | transloco }}
            </figcaption>
            <div class="specimen-col">
              <span appEyebrow>{{ 'styleguide.eyebrowPlain' | transloco }}</span>
              <span appEyebrow mark>{{ 'styleguide.eyebrowMarked' | transloco }}</span>
            </div>
          </figure>

          <figure class="specimen" appPanel>
            <figcaption appEyebrow>
              {{ 'styleguide.cartouche' | transloco }}
            </figcaption>
            <div class="specimen-row">
              <span class="text-2xl text-accent" appCartouche>Hexly</span>
            </div>
          </figure>

          <figure class="specimen" appPanel>
            <figcaption appEyebrow>
              {{ 'styleguide.swatches' | transloco }}
            </figcaption>
            <div class="specimen-row">
              @for (s of terrain; track s.token) {
                <span appSwatch [style.background]="'var(' + s.token + ')'" [title]="s.nameKey | transloco"></span>
              }
            </div>
          </figure>

          <figure class="specimen" appPanel>
            <figcaption appEyebrow>
              {{ 'styleguide.dots' | transloco }}
            </figcaption>
            <div class="specimen-row">
              <span class="inline-flex items-center gap-2 text-sm text-ink-muted">
                <span appDot></span>{{ 'styleguide.dotIdle' | transloco }}
              </span>
              <span class="inline-flex items-center gap-2 text-sm text-ink-muted">
                <span appDot success></span>{{ 'styleguide.dotHealthy' | transloco }}
              </span>
            </div>
          </figure>

          <figure class="specimen" appPanel>
            <figcaption appEyebrow>
              {{ 'styleguide.rule' | transloco }}
            </figcaption>
            <div class="specimen-col text-sm text-ink-muted">
              <span>{{ 'styleguide.ruleBefore' | transloco }}</span>
              <hr appRule />
              <span>{{ 'styleguide.ruleAfter' | transloco }}</span>
            </div>
          </figure>

          <figure class="specimen" appPanel>
            <figcaption appEyebrow>
              {{ 'styleguide.panels' | transloco }}
            </figcaption>
            <div class="specimen-row">
              <span class="specimen-panel" appPanel>{{ 'styleguide.panelDefault' | transloco }}</span>
              <span class="specimen-panel" appPanel raised>{{ 'styleguide.panelRaised' | transloco }}</span>
              <span class="specimen-panel" appPanel flush>{{ 'styleguide.panelFlush' | transloco }}</span>
            </div>
          </figure>

          <figure class="specimen" appPanel>
            <figcaption appEyebrow>
              {{ 'styleguide.listbox' | transloco }}
            </figcaption>
            <ul
              role="listbox"
              [attr.aria-label]="'styleguide.fieldTerrain' | transloco"
              class="w-full max-w-64 overflow-auto rounded-md border border-line bg-surface py-1 shadow-2"
            >
              <li appListboxOption optionId="sg-lb-1" testid="sg-lb-1" [selected]="false">Grassland</li>
              <li appListboxOption optionId="sg-lb-2" testid="sg-lb-2" [selected]="true">Whisperwood</li>
              <li appListboxOption optionId="sg-lb-3" testid="sg-lb-3" [selected]="false">Mountains</li>
              <li appListboxOption optionId="sg-lb-4" testid="sg-lb-4" [selected]="false">Ocean</li>
            </ul>
          </figure>

          <figure class="specimen is-wide" appPanel>
            <figcaption appEyebrow>
              {{ 'styleguide.pageHeader' | transloco }}
            </figcaption>
            <div class="rounded-md overflow-hidden border border-line">
              <app-page-header>
                <app-icon pageHeaderLeading name="logo" [size]="24" />
                <span pageHeaderTitle class="font-display text-md text-ink-strong">The Reach of Aldermoor</span>
                <button
                  pageHeaderActions
                  appIconButton
                  size="sm"
                  [title]="'styleguide.iconSettings' | transloco"
                  [attr.aria-label]="'styleguide.iconSettings' | transloco"
                >
                  <app-icon name="settings" [size]="16" />
                </button>
                <button pageHeaderActions appButton variant="primary" size="sm">
                  {{ 'styleguide.shareMap' | transloco }}
                </button>
              </app-page-header>
            </div>
          </figure>

          <figure class="specimen" appPanel>
            <figcaption appEyebrow>
              {{ 'styleguide.dialog' | transloco }}
            </figcaption>
            <div class="specimen-row">
              <button appButton danger (click)="dialogOpen.set(true)">
                {{ 'styleguide.dialogTrigger' | transloco }}
              </button>
            </div>
            <app-dialog
              [open]="dialogOpen()"
              [heading]="'styleguide.dialogHeading' | transloco"
              (closed)="dialogOpen.set(false)"
            >
              <p class="text-sm text-ink-muted">{{ 'styleguide.dialogBody' | transloco }}</p>
              <button dialogFooter appButton (click)="dialogOpen.set(false)">
                {{ 'common.cancel' | transloco }}
              </button>
              <button dialogFooter appButton danger (click)="dialogOpen.set(false)">
                {{ 'styleguide.dialogConfirm' | transloco }}
              </button>
            </app-dialog>
          </figure>

          <figure class="specimen is-wide" appPanel>
            <figcaption appEyebrow>
              {{ 'styleguide.icons' | transloco }}
            </figcaption>
            <div class="icongrid">
              @for (name of coreIcons; track name) {
                <figure class="iconcard">
                  <app-icon [name]="name" [size]="22" />
                  <code>{{ name }}</code>
                </figure>
              }
            </div>
          </figure>
        </div>
      </section>

      <footer class="guide-foot">
        <span class="brand" appCartouche>Hexly</span>
        <span>{{ 'styleguide.footerTokens' | transloco }} · <code>apps/web/src/styles</code></span>
      </footer>
    </main>
  `,
  styles: `
    @reference '#app-styles.css';

    /* Styleguide — layout only; specimens use the primitives and global classes. */

    .hero-lede {
      @apply text-md leading-normal text-ink-muted;
      max-width: var(--container-reading);
    }
    .hero-lede code,
    .section-note code,
    figcaption code {
      @apply font-mono text-accent-strong;
      font-size: 0.86em;
    }

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
      background: linear-gradient(90deg, var(--color-accent), var(--color-accent-strong));
    }
    .radii {
      @apply flex flex-wrap gap-4;
    }
    .radiicard {
      @apply flex flex-col items-center gap-2 m-0 font-mono text-2xs text-ink-muted;
    }
    .radiicard-box {
      @apply w-16 h-16 bg-surface-sunken border border-accent;
    }

    .specimens {
      @apply grid gap-4;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    }
    .specimen {
      @apply flex flex-col gap-4 p-4 m-0;
    }
    /* Specimens that don't tile neatly in a 280px column — page header, icon grid. */
    .specimen.is-wide {
      grid-column: 1 / -1;
    }
    .specimen-row {
      @apply flex flex-wrap items-center gap-3;
    }
    .specimen-col {
      @apply flex flex-col gap-3;
    }
    .specimen-panel {
      @apply flex items-center justify-center p-3 text-2xs text-ink-muted;
      min-width: 5rem;
    }

    .icongrid {
      @apply grid gap-3;
      grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
    }
    .iconcard {
      @apply flex flex-col items-center gap-2 m-0 p-3 rounded-md border border-line-faint text-ink;
    }
    .iconcard code {
      @apply font-mono text-2xs text-ink-faint;
    }

    .guide-foot {
      @apply flex justify-between items-center pt-6 border-t border-line text-sm text-ink-muted;
    }
    .guide-foot .brand {
      @apply text-md text-accent;
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
export class StyleguidePage {
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
    { token: '--color-accent', nameKey: 'styleguide.swatch.compassGold' },
    { token: '--color-danger', nameKey: 'styleguide.swatch.marginalia' },
    { token: '--color-success', nameKey: 'styleguide.swatch.moss' },
    { token: '--color-line-strong', nameKey: 'styleguide.swatch.drawnRule' },
  ];

  /** The categorical set, each with a glyph — the channel that survives where the hue does not. */
  protected readonly tones: readonly { tone: ChipTone; icon: IconName }[] = [
    { tone: 'tone-1', icon: 'region' },
    { tone: 'tone-2', icon: 'label' },
    { tone: 'tone-3', icon: 'library' },
    { tone: 'tone-4', icon: 'graph' },
    { tone: 'tone-5', icon: 'terrain' },
    { tone: 'tone-6', icon: 'user' },
    { tone: 'tone-7', icon: 'globe' },
    { tone: 'tone-8', icon: 'link' },
  ];

  /**
   * The hexmap plugin's terrain fills — tier 3, named here under the exemption this page holds, since
   * rendering every token in the system is what it is for (ADR-0075, world-theme-spec §4). The spec
   * holds the list to `terrainSet`.
   */
  protected readonly terrain: SwatchRow[] = [
    { token: '--color-terrain-grass', nameKey: 'styleguide.swatch.grassland' },
    { token: '--color-terrain-forest', nameKey: 'styleguide.swatch.forest' },
    { token: '--color-terrain-ocean', nameKey: 'styleguide.swatch.ocean' },
    {
      token: '--color-terrain-mountain',
      nameKey: 'styleguide.swatch.mountains',
    },
    { token: '--color-terrain-desert', nameKey: 'styleguide.swatch.desert' },
    { token: '--color-terrain-sky', nameKey: 'styleguide.swatch.sky' },
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

  protected readonly radii: readonly DesignToken[] = ['--radius-sm', '--radius-md', '--radius-lg', '--radius-xl'];

  /** Drives the live dialog specimen. */
  protected readonly dialogOpen = signal(false);

  /** Every glyph web-ui ships (the two bespoke plus the Lucide-backed core), for the icon gallery. */
  protected readonly coreIcons: readonly string[] = [
    'logo',
    'region',
    'check',
    'chevrons',
    'chevron-down',
    'close',
    'dashboard',
    'pencil',
    'spinner',
    'more',
    'outline',
    'link',
    'external-link',
    'erase',
    'fit',
    'graph',
    'label',
    'library',
    'palette',
    'marquee',
    'minus',
    'moon',
    'plus',
    'redo',
    'select',
    'settings',
    'share',
    'sun',
    'terrain',
    'undo',
    'upload',
    'download',
    'user',
    'globe',
  ];
}
