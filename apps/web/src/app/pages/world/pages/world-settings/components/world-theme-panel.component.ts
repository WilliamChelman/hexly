import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { WorldThemePalette } from '@hexly/domain';
import { ActiveWorld, ColorScheme, ToasterService, WorldThemeApplier, WorldsClient } from '@hexly/web-core';
import { ButtonComponent, EyebrowComponent } from '@hexly/web-ui';
import { ThemeDraft, draftFrom, draftToTheme, hexlyPalette, sameDraft, withControlValue } from '../utils/theme-draft';
import { PaletteEdit, ThemePaletteComponent } from './theme-palette.component';

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
  imports: [TranslocoPipe, ButtonComponent, EyebrowComponent, ThemePaletteComponent],
  template: `
    <div class="theme-editor">
      <!-- One section per part of the contract; the radius set and font pairing take their own. -->
      <section class="group">
        <h2 appEyebrow>{{ 'worldTheme.paletteHeading' | transloco }}</h2>
        <app-theme-palette [palettes]="palettes()" (changed)="apply($event)" />
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
  `,
})
export class WorldThemePanelComponent {
  readonly id = input.required<string>();

  private readonly worlds = inject(WorldsClient);
  private readonly activeWorld = inject(ActiveWorld);
  private readonly applier = inject(WorldThemeApplier);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);

  /** Hexly's own two Palettes: what the controls show for an unthemed World, and what a first edit
   * materialises a draft from. */
  private readonly defaults: Readonly<Record<ColorScheme, WorldThemePalette>> = {
    solar: hexlyPalette('solar'),
    astral: hexlyPalette('astral'),
  };

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

  /** What the controls show: the draft where there is one, the Hexly default where there is not. */
  protected readonly palettes = computed<Readonly<Record<ColorScheme, WorldThemePalette>>>(() => {
    const draft = this.draft();
    return draft ?? this.defaults;
  });

  constructor() {
    effect(() => this.applier.preview(this.draft()));
    // Leaving the editor is a cancel: the saved Theme comes back, whatever the draft still held.
    inject(DestroyRef).onDestroy(() => this.applier.preview(undefined));
  }

  /**
   * Fold one moved control into the draft. A first edit on an unthemed World materialises the whole
   * Theme from the Hexly default: a stored Theme carries both Palettes entire (ADR-0076), so there is
   * no "this anchor only" to send.
   */
  protected apply({ scheme, control, raw }: PaletteEdit): void {
    const draft: ThemeDraft = this.draft() ?? { ...this.defaults };
    this.draft.set({ ...draft, [scheme]: withControlValue(draft[scheme], control, raw) });
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
