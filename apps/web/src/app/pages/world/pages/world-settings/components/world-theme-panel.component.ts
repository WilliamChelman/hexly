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
import { ButtonComponent } from '@hexly/web-ui';
import { ThemeDraft, draftFrom, draftToTheme, hexlyPalette, sameDraft, withControlValue } from '../utils/theme-draft';
import { PaletteEdit, ThemePaletteComponent } from './theme-palette.component';

/**
 * The World Theme editor (ADR-0076, #371): a World Owner authors their Palette — both ColorSchemes'
 * anchors and knobs — and watches it apply as they type.
 *
 * Live preview goes through {@link WorldThemeApplier.preview}, the same resolution chain the saved
 * Theme is painted by, so what the Owner judges is what the World will look like rather than an
 * approximation of it. A preview is deliberately not cached and not scoped: a draft abandoned by a
 * reload, a navigation, or another tab is simply gone.
 *
 * The draft is a Theme *or* `null`, and `null` is a state rather than an empty one — it is the World
 * carrying no Theme, which is what **reset** stages and what saving it then clears the World back to.
 * Everything commits at one point, so **discard** always answers **reset** as well as every anchor
 * moved since the panel opened.
 *
 * Extension points, all of them draft fields this editor already round-trips untouched: #374's
 * per-token overrides (`overrides`), and #375's radii and font pairing (`radii`, `fontPairing`).
 */
@Component({
  selector: 'app-world-theme',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, ButtonComponent, ThemePaletteComponent],
  template: `
    <div class="theme-editor">
      <app-theme-palette [palettes]="palettes()" (changed)="apply($event)" />

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

  /**
   * Hexly's own two Palettes, read off the document once — what the controls show for a World with no
   * Theme, and the values a first edit materialises a draft from.
   */
  private readonly defaults: Readonly<Record<ColorScheme, WorldThemePalette>> = {
    solar: hexlyPalette('solar'),
    astral: hexlyPalette('astral'),
  };

  /**
   * The Theme as stored, from the World the resolver already pinned (ADR-0028) — no second read. Keyed
   * on its serialised form so a live-follow refetch that touched something else does not look like a
   * Theme change and take an Owner's in-progress draft away.
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
   * Theme from the Hexly default, because a stored Theme carries both Palettes entire — there is no
   * "this anchor only" to send.
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
