import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  OnInit,
  signal,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { FontPairingId, WorldTheme, WorldThemePalette, WorldThemeSource } from '@hexly/domain';
import {
  ActiveWorld,
  ColorScheme,
  INSTANCE_THEME,
  ThemeDeclarationSet,
  ToasterService,
  WorldThemeApplier,
  WorldsClient,
  resolveWorldTheme,
} from '@hexly/web-core';
import { ButtonComponent, EyebrowComponent } from '@hexly/web-ui';
import {
  RadiusPreset,
  ThemeDraft,
  defaultPalettes,
  draftFrom,
  draftToTheme,
  sameDraft,
  withControlValue,
  withOverride,
} from '../utils/theme-draft';
import { PaletteEdit, ThemePaletteComponent } from './theme-palette.component';
import { OverrideEdit, ThemeOverridesComponent } from './theme-overrides.component';
import { ThemeFontsComponent } from './theme-fonts.component';
import { ThemeRadiiComponent } from './theme-radii.component';
import { ThemeCopyComponent } from './theme-copy.component';

/**
 * The World Theme editor (ADR-0076): a World Owner authors both ColorSchemes' anchors and knobs and
 * watches them apply. Preview goes through {@link WorldThemeApplier.preview} — the same resolution
 * chain the saved Theme paints by, so what the Owner judges is what the World will look like.
 *
 * The draft is a World Theme *or* `null`, `null` being the World carrying none: what **reset** stages,
 * and what saving it clears the World back to. One commit point, so **cancel** answers reset too.
 */
@Component({
  selector: 'app-world-theme',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslocoPipe,
    ButtonComponent,
    EyebrowComponent,
    ThemePaletteComponent,
    ThemeOverridesComponent,
    ThemeRadiiComponent,
    ThemeFontsComponent,
    ThemeCopyComponent,
  ],
  template: `
    <div class="theme-editor">
      <!-- First: a copy is where an Owner reusing a Theme starts, not something they reach for
           after authoring one. -->
      <section class="group">
        <h2 appEyebrow>{{ 'worldTheme.copyHeading' | transloco }}</h2>
        <p class="lede">{{ 'worldTheme.copyLede' | transloco }}</p>
        <app-theme-copy [sources]="copySources()" (copied)="copyFrom($event)" />
      </section>

      <!-- One section per part of the contract; the radius set and font pairing take their own. -->
      <section class="group">
        <h2 appEyebrow>{{ 'worldTheme.paletteHeading' | transloco }}</h2>
        <app-theme-palette [palettes]="palettes()" [declarations]="declarations()" (changed)="apply($event)" />
      </section>

      <section class="group">
        <h2 appEyebrow>{{ 'worldTheme.overridesHeading' | transloco }}</h2>
        <p class="hint">{{ 'worldTheme.overridesHint' | transloco }}</p>
        <app-theme-overrides [overrides]="draft()?.overrides" (changed)="applyOverride($event)" />
      </section>

      <section class="group">
        <h2 appEyebrow>{{ 'worldTheme.radiiHeading' | transloco }}</h2>
        <p class="lede">{{ 'worldTheme.radiiLede' | transloco }}</p>
        <app-theme-radii [radii]="draft()?.radii" (picked)="pickRadii($event)" />
      </section>

      <section class="group">
        <h2 appEyebrow>{{ 'worldTheme.fontsHeading' | transloco }}</h2>
        <p class="lede">{{ 'worldTheme.fontsLede' | transloco }}</p>
        <app-theme-fonts [fontPairing]="draft()?.fontPairing" (picked)="pickFontPairing($event)" />
      </section>

      <div class="actions">
        <button
          appButton
          variant="primary"
          size="sm"
          data-testid="theme-save"
          [disabled]="!dirty() || saving()"
          (click)="save()"
        >
          {{ 'worldTheme.save' | transloco }}
        </button>
        <button appButton size="sm" data-testid="theme-discard" [disabled]="!dirty() || saving()" (click)="discard()">
          {{ 'common.cancel' | transloco }}
        </button>
        <button
          appButton
          size="sm"
          data-testid="theme-reset"
          [disabled]="draft() === null || saving()"
          (click)="reset()"
        >
          {{ 'worldTheme.reset' | transloco }}
        </button>
        @if (dirty()) {
          <span class="unsaved" data-testid="theme-unsaved">{{ 'worldTheme.unsaved' | transloco }}</span>
        }
      </div>
    </div>
  `,
  styles: `
    @reference '#app-styles.css';
    .theme-editor {
      @apply flex flex-col gap-5;
    }
    .group {
      @apply flex flex-col gap-3;
    }
    .actions {
      @apply flex flex-wrap items-center gap-2;
    }
    .unsaved {
      @apply text-xs text-ink-muted;
    }
    .hint {
      @apply -mt-1 text-xs text-ink-muted;
    }
    .lede {
      @apply -mt-2 text-xs text-ink-muted;
    }
  `,
})
export class WorldThemePanelComponent implements OnInit {
  readonly id = input.required<string>();

  private readonly worlds = inject(WorldsClient);
  private readonly activeWorld = inject(ActiveWorld);
  private readonly applier = inject(WorldThemeApplier);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);

  /** Instance default over Hexly's own, anchor by anchor — what a first edit materialises from (ADR-0076). */
  private readonly instance = inject(INSTANCE_THEME);
  private readonly defaults: Readonly<Record<ColorScheme, WorldThemePalette>> = defaultPalettes(this.instance);

  /**
   * The Theme as stored, off the World the resolver already pinned (ADR-0028) — no second read. Keyed
   * on its serialised form, so a live-follow refetch that touched something else cannot read as a Theme
   * change and take an in-progress draft away.
   */
  private readonly storedJson = computed(() => JSON.stringify(this.activeWorld.world()?.theme ?? null));
  private readonly stored = computed(() => draftFrom(JSON.parse(this.storedJson())));

  protected readonly draft = linkedSignal<string, ThemeDraft | null>({
    source: this.storedJson,
    computation: (json) => draftFrom(JSON.parse(json)),
  });
  protected readonly saving = signal(false);
  protected readonly dirty = computed(() => !sameDraft(this.draft(), this.stored()));

  /**
   * What the controls show: the draft where there is one, the Hexly default where there is not.
   *
   * Typed as the whole draft, not just its two Palettes — the tier-2 overrides ride in the same object,
   * and narrowing the return to `Record<ColorScheme, WorldThemePalette>` denied three fields that are
   * present and made {@link declarations} spread the same object twice to get them back.
   */
  protected readonly palettes = computed<ThemeDraft>(() => this.draft() ?? this.defaults);

  /**
   * The chain resolved to what would land on the root — the same layers {@link WorldThemeApplier.preview}
   * paints by, so the contrast report (#373) is over the declarations that render rather than over the
   * anchors alone. A draft's tier-2 overrides ride here, and they are what an Owner reaches for when a
   * derived role is not what they wanted.
   */
  protected readonly declarations = computed<ThemeDeclarationSet>(() =>
    resolveWorldTheme([this.instance, this.palettes()]),
  );

  /** The Worlds this Owner may copy a Theme from (#376); `null` until the server has answered. */
  protected readonly copySources = signal<readonly WorldThemeSource[] | null>(null);

  constructor() {
    effect(() => this.applier.preview(this.draft()));
    // Leaving the editor is a cancel: the saved Theme comes back, whatever the draft still held.
    inject(DestroyRef).onDestroy(() => this.applier.preview(undefined));
  }

  ngOnInit(): void {
    // Read once: the offer is other Worlds' stored Themes, which this World's own nudges say nothing
    // about. A failure leaves it unanswered rather than taking the editor down with it.
    this.worlds.themeSources(this.id()).subscribe({
      next: (sources) => this.copySources.set(sources),
      error: () => this.toaster.show(this.transloco.translate('worldTheme.copyLoadError'), 'error'),
    });
  }

  /**
   * Stage another World's Theme as this one's draft (#376) — staged, not applied, so the copy previews
   * and cancels like any other edit and commits through the one {@link save}.
   */
  protected copyFrom(theme: WorldTheme): void {
    // `draftFrom` drops the source's `version`, which `save` re-stamps: a copy carries the contract
    // this build knows, not the one it was authored against.
    this.draft.set(draftFrom(theme));
  }

  /** Fold one moved control into the draft. */
  protected apply({ scheme, control, raw }: PaletteEdit): void {
    const draft = this.materialised();
    this.draft.set({ ...draft, [scheme]: withControlValue(draft[scheme], control, raw) });
  }

  /**
   * Fold one tier-2 opt-out into the draft (#374). Materialises the whole Theme for the same reason a
   * moved anchor does — a stored Theme carries both Palettes entire.
   *
   * An emptied field is left alone rather than stored or read as a clear, as {@link withControlValue}
   * leaves an emptied knob: it is not a value of any token's type, and clearing mid-retype would take
   * the field away from under the Owner. Clearing is the ✕.
   */
  protected applyOverride({ scheme, control, raw }: OverrideEdit): void {
    if (raw !== null && raw.trim() === '') return;
    const draft: ThemeDraft = this.draft() ?? { ...this.defaults };
    this.draft.set({ ...draft, overrides: withOverride(draft.overrides, scheme, control.token, raw) });
  }

  /**
   * Fold a picked corner-radius set into the draft (#375). Stored as its five values and not as an id
   * (ADR-0076), and cleared outright for the Hexly default — a World wears that one by carrying none.
   */
  protected pickRadii(preset: RadiusPreset): void {
    this.draft.set(this.picked({ radii: preset.radii }));
  }

  /** Fold a picked font pairing into the draft; `undefined` is the pairing the stylesheet ships. */
  protected pickFontPairing(id: FontPairingId | undefined): void {
    this.draft.set(this.picked({ fontPairing: id }));
  }

  /**
   * The draft a pick lands on. Picking the default on an unthemed World leaves it unthemed — otherwise
   * the save would store twenty-two anchors and change nothing.
   */
  private picked(part: Partial<ThemeDraft>): ThemeDraft | null {
    const draft = this.draft();
    if (!draft && Object.values(part).every((value) => value === undefined)) return null;
    return { ...(draft ?? this.materialised()), ...part };
  }

  /**
   * The draft an edit lands on. A first edit to an unthemed World materialises the whole Theme from the
   * Hexly default: a stored Theme carries both Palettes entire (ADR-0076), so there is no "this anchor
   * only" to send.
   */
  private materialised(): ThemeDraft {
    return this.draft() ?? { ...this.defaults };
  }

  /** Stage the Hexly default. Saving it is what actually returns the World to it. */
  protected reset(): void {
    this.draft.set(null);
  }

  protected discard(): void {
    this.draft.set(this.stored());
  }

  protected save(): void {
    const draft = this.draft();
    this.saving.set(true);
    this.worlds.setTheme(this.id(), draft && draftToTheme(draft)).subscribe({
      // Re-pinning the returned World makes the canonicalised Theme authoritative — it re-paints, it
      // caches, and the draft relinks to it, so the Owner sees exactly what stored.
      next: (world) => {
        this.activeWorld.set(world);
        this.saving.set(false);
      },
      error: () => {
        this.saving.set(false);
        this.toaster.show(this.transloco.translate('worldTheme.saveError'), 'error');
      },
    });
  }
}
