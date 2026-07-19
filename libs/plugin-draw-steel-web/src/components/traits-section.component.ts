import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ButtonComponent, InputComponent, TextareaComponent } from '@hexly/web-ui';
import { Trait } from '@hexly/plugin-draw-steel';

/**
 * The passive **Traits** section of the {@link StatBlockViewComponent} (#245). A lens, like the rest of the
 * card: it holds no list — it reads the raw `traits` value and emits the next `Trait[]` for the View to
 * write back (an empty array clears the key).
 */
@Component({
  selector: 'ds-traits-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  imports: [TranslocoPipe, ButtonComponent, InputComponent, TextareaComponent],
  template: `
    <section class="border-b border-line py-3" data-testid="section-traits">
      <h3 class="m-0 mb-1 text-sm font-semibold text-sea">{{ 'drawSteel.statBlock.section.traits' | transloco }}</h3>

      @if (writable()) {
        <div class="flex flex-col gap-3">
          <!-- Tracked by index: a trait has no stable key and may be blank or duplicate. -->
          @for (trait of traits(); track $index) {
            <div class="rounded border border-line bg-surface-sunken p-2" [attr.data-testid]="'trait-' + $index">
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
          <dl class="m-0 flex flex-col gap-1.5 text-sm">
            @for (trait of traits(); track $index) {
              <div [attr.data-testid]="'trait-' + $index">
                <dt class="inline font-semibold text-ink">{{ trait.name || '—' }}</dt>
                @if (trait.effect) {
                  <dd class="m-0 inline text-ink-muted">— {{ trait.effect }}</dd>
                }
              </div>
            }
          </dl>
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
