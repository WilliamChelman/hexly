import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ButtonComponent, IconComponent, InputComponent, TextareaComponent } from '@hexly/web-ui';
import { Trait } from '@hexly/plugin-draw-steel';

/**
 * The passive **Traits** section of the {@link StatBlockViewComponent} (#245). A lens, like the rest of the
 * card: it holds no list — it reads the raw `traits` value and emits the next `Trait[]` for the View to
 * write back (an empty array clears the key).
 *
 * The read view is the "Bestiary Spread" prose block (#stat-block-oomph): each trait flows as `name. effect`
 * under a serif, glyph-marked heading; the edit view keeps the stacked control cards.
 */
@Component({
  selector: 'ds-traits-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  imports: [TranslocoPipe, ButtonComponent, InputComponent, TextareaComponent, IconComponent],
  template: `
    <section class="border-b border-line py-3 last:border-b-0" data-testid="section-traits">
      <h3 class="m-0 mb-2 flex items-center gap-1.5 font-serif text-lg font-bold italic text-accent-strong">
        <app-icon name="ds-trait" class="text-base not-italic" />{{ 'drawSteel.statBlock.section.traits' | transloco }}
      </h3>

      @if (writable()) {
        <div class="flex flex-col gap-3">
          <!-- Tracked by index: a trait has no stable key and may be blank or duplicate. -->
          @for (trait of traits(); track $index; let first = $first; let last = $last) {
            <div class="rounded-md border border-line bg-surface-sunken p-2" [attr.data-testid]="'trait-' + $index">
              <div class="flex items-center gap-2">
                <input
                  appInput
                  class="flex-1"
                  data-testid="trait-name"
                  [value]="trait.name"
                  [placeholder]="'drawSteel.statBlock.traitName' | transloco"
                  (input)="setName($index, $event)"
                />
                <button
                  type="button"
                  appButton
                  variant="ghost"
                  size="sm"
                  icon
                  data-testid="trait-move-up"
                  [disabled]="first"
                  [title]="'drawSteel.statBlock.moveUp' | transloco"
                  [attr.aria-label]="'drawSteel.statBlock.moveUp' | transloco"
                  (click)="moveTrait($index, -1)"
                >
                  ↑
                </button>
                <button
                  type="button"
                  appButton
                  variant="ghost"
                  size="sm"
                  icon
                  data-testid="trait-move-down"
                  [disabled]="last"
                  [title]="'drawSteel.statBlock.moveDown' | transloco"
                  [attr.aria-label]="'drawSteel.statBlock.moveDown' | transloco"
                  (click)="moveTrait($index, 1)"
                >
                  ↓
                </button>
                <button
                  type="button"
                  appButton
                  variant="ghost"
                  size="sm"
                  icon
                  danger
                  data-testid="trait-remove"
                  [title]="'drawSteel.statBlock.removeTrait' | transloco"
                  [attr.aria-label]="'drawSteel.statBlock.removeTrait' | transloco"
                  (click)="removeTrait($index)"
                >
                  ✕
                </button>
              </div>
              <textarea
                appTextarea
                class="mt-2"
                data-testid="trait-effect"
                [value]="trait.effect"
                [placeholder]="'drawSteel.statBlock.traitEffect' | transloco"
                (input)="setEffect($index, $event)"
              ></textarea>
            </div>
          }
          <div>
            <button type="button" appButton variant="ghost" size="sm" data-testid="trait-add" (click)="addTrait()">
              {{ 'drawSteel.statBlock.addTrait' | transloco }}
            </button>
          </div>
        </div>
      } @else {
        @if (traits().length) {
          <div class="space-y-1.5 text-[15px] leading-relaxed">
            @for (trait of traits(); track $index) {
              <p class="m-0" [attr.data-testid]="'trait-' + $index">
                <span class="font-semibold text-ink-strong">{{ trait.name || '—' }}.</span>
                <span class="text-ink">{{ trait.effect }}</span>
              </p>
            }
          </div>
        } @else {
          <p class="m-0 text-sm italic text-ink-faint">{{ 'drawSteel.statBlock.noTraits' | transloco }}</p>
        }
      }
    </section>
  `,
})
export class TraitsSectionComponent {
  /** The raw `traits` value off the block — a lens, never copied. */
  readonly value = input<unknown>();
  readonly writable = input(false);
  readonly valueChange = output<Trait[]>();

  protected readonly traits = computed<Trait[]>(() => asTraits(this.value()));

  protected addTrait(): void {
    this.valueChange.emit([...this.traits(), { name: '', effect: '' }]);
  }

  /** Emitting `[]` for the last trait lets the View clear the key (no `{ traits: [] }` husk). */
  protected removeTrait(index: number): void {
    this.valueChange.emit(this.traits().filter((_, i) => i !== index));
  }

  /** Swap a trait with its neighbour to reorder within the section; a no-op past either end. */
  protected moveTrait(index: number, delta: number): void {
    const next = [...this.traits()];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    this.valueChange.emit(next);
  }

  protected setName(index: number, event: Event): void {
    this.patch(index, { name: (event.target as HTMLInputElement).value });
  }

  protected setEffect(index: number, event: Event): void {
    this.patch(index, { effect: (event.target as HTMLTextAreaElement).value });
  }

  private patch(index: number, change: Partial<Trait>): void {
    this.valueChange.emit(this.traits().map((trait, i) => (i === index ? { ...trait, ...change } : trait)));
  }
}

/** Forward-only: a non-array reads empty, and a non-string `name`/`effect` reads blank rather than throwing. */
function asTraits(value: unknown): Trait[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({
      name: typeof item['name'] === 'string' ? item['name'] : '',
      effect: typeof item['effect'] === 'string' ? item['effect'] : '',
    }));
}
