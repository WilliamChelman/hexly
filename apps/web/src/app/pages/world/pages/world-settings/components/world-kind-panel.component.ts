import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { DEFAULT_WORLD_KIND, WorldKind, worldKindSchema } from '@hexly/domain';
import { ActiveWorld, ToasterService, WorldsClient } from '@hexly/web-core';
import { CardRadioComponent, CardRadioGroupComponent } from '@hexly/web-ui';

/**
 * Campaign-or-Shelf (ADR-0080): the one surface that writes the label, for a World Owner.
 *
 * A pick commits at once — there is nothing to stage, the whole edit being one of two values — and
 * the returned World is re-pinned so the World Index regroups off the same read. Deliberately says
 * what a Shelf *keeps*: the label is read by the Index's grouping and by nothing else, so an Owner
 * choosing it is not withholding anything from the World.
 */
@Component({
  selector: 'app-world-kind',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, CardRadioComponent, CardRadioGroupComponent],
  template: `
    <div class="picker" appCardRadioGroup [attr.aria-label]="'worldKind.heading' | transloco">
      @for (kind of kinds; track kind) {
        <app-card-radio
          name="world-kind"
          basis="16rem"
          [testId]="'world-kind-' + kind"
          [checked]="kind === selected()"
          [label]="'worldKind.' + kind | transloco"
          [hint]="'worldKind.hint.' + kind | transloco"
          (picked)="pick(kind)"
        />
      }
    </div>
    <p class="note" data-testid="world-kind-note">{{ 'worldKind.note' | transloco }}</p>
  `,
  styles: `
    @reference '#app-styles.css';
    .picker {
      @apply mb-3;
    }
    .note {
      @apply text-xs text-ink-muted;
    }
  `,
})
export class WorldKindPanelComponent {
  readonly id = input.required<string>();

  private readonly worlds = inject(WorldsClient);
  private readonly activeWorld = inject(ActiveWorld);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);

  protected readonly kinds: readonly WorldKind[] = worldKindSchema.options;

  /** The pick in flight, cleared by whichever answer lands. */
  private readonly saving = signal<WorldKind | null>(null);

  /**
   * What the controls show: the pick in flight where there is one, else the World as pinned — so the
   * radio moves on the click rather than on the round trip, and a failure falls back to stored.
   */
  protected readonly selected = computed<WorldKind>(
    () => this.saving() ?? this.activeWorld.world()?.kind ?? DEFAULT_WORLD_KIND,
  );

  protected pick(kind: WorldKind): void {
    if (kind === this.selected()) return;
    this.saving.set(kind);
    this.worlds.setKind(this.id(), kind).subscribe({
      // Re-pinning the returned World is what makes the label authoritative — the World Index reads
      // its own list, but the Switcher and this page read the pinned detail.
      next: (world) => {
        this.activeWorld.set(world);
        this.saving.set(null);
      },
      error: () => {
        this.saving.set(null);
        this.toaster.show(this.transloco.translate('worldKind.saveError'), 'error');
      },
    });
  }
}
