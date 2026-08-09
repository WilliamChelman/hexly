import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ActiveWorld, ToasterService, WorldsClient } from '@hexly/web-core';
import { CardRadioComponent, CardRadioGroupComponent } from '@hexly/web-ui';

/**
 * The Open-World toggle (ADR-0084), successor to the World Public Link: the one surface that marks a
 * World Open, for a World Owner. A two-card pick modelled on {@link WorldKindPanelComponent} — it
 * commits at once and re-pins the returned World so the flag reads back. Owner-gated server-side; the
 * hosting page only mounts it for a caller who may manage the World, and only with Collaboration on.
 */
@Component({
  selector: 'app-world-open',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, CardRadioComponent, CardRadioGroupComponent],
  template: `
    <div class="picker" appCardRadioGroup [attr.aria-label]="'worldOpen.heading' | transloco">
      @for (option of options; track option.open) {
        <app-card-radio
          name="world-open"
          basis="16rem"
          [testId]="'world-open-' + option.key"
          [checked]="option.open === selected()"
          [label]="'worldOpen.' + option.key | transloco"
          [hint]="'worldOpen.hint.' + option.key | transloco"
          (picked)="pick(option.open)"
        />
      }
    </div>
    <p class="note" data-testid="world-open-note">{{ 'worldOpen.note' | transloco }}</p>
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
export class WorldOpenPanelComponent {
  readonly id = input.required<string>();

  private readonly worlds = inject(WorldsClient);
  private readonly activeWorld = inject(ActiveWorld);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);

  /** Closed first — the safe default a fresh World carries (ADR-0084). */
  protected readonly options = [
    { key: 'closed' as const, open: false },
    { key: 'open' as const, open: true },
  ];

  /** The pick in flight, cleared by whichever answer lands. */
  private readonly saving = signal<boolean | null>(null);

  /**
   * What the controls show: the pick in flight where there is one, else the World as pinned — so the
   * card moves on the click rather than on the round trip, and a failure falls back to stored.
   */
  protected readonly selected = computed<boolean>(() => this.saving() ?? this.activeWorld.world()?.open ?? false);

  protected pick(open: boolean): void {
    if (open === this.selected()) return;
    this.saving.set(open);
    this.worlds.setOpen(this.id(), open).subscribe({
      // Re-pinning the returned World is what makes the flag authoritative here and in the Switcher.
      next: (world) => {
        this.activeWorld.set(world);
        this.saving.set(null);
      },
      error: () => {
        this.saving.set(null);
        this.toaster.show(this.transloco.translate('worldOpen.saveError'), 'error');
      },
    });
  }
}
