import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Field, EntityDocument, NO_STRUCTURED_DATA_TYPES, validateFields, writeField } from '@hexly/domain';
import { ButtonComponent, ChipComponent, ChipTone, IconName } from '@hexly/web-ui';
import { TypeRegistry } from '../../../entity-types/type-registry';
import { FieldControlComponent, typeTone } from '@hexly/web-entity';

/**
 * Pick, add, remove, and reorder an Entity's ordered Entity Type set, `types[0]` primary (ADR-0048).
 * Presentational: reads `types`/`metadata`, emits the authored set. Adding a type with unfilled required
 * Fields opens an inline prompt ({@link FieldControlComponent} + {@link validateFields}) offering to collect
 * them — filled or not, adding is never gated on describing (ADR-0074), and dismissing the prompt adds
 * nothing (#338). Removing only drops the lens, leaving its EntityDocument behind (CONTEXT.md → Field).
 */
@Component({
  selector: 'app-entity-types-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, ChipComponent, ButtonComponent, FieldControlComponent],
  template: `
    <div class="flex flex-col gap-3" data-testid="entity-types-editor">
      <div class="flex flex-wrap items-center gap-2">
        @for (type of types(); track type; let i = $index) {
          <!-- The icon, not the tone, is what carries the category: the tone arc is the deuteranope
               confusion line (ADR-0075). Primacy is the "· Primary" marker, never the colour. -->
          <app-chip [tone]="toneOf(type)" [icon]="iconOf(type)" [attr.data-testid]="'type-chip-' + type">
            {{ typeLabel(type) }}
            @if (i === 0) {
              <span class="text-2xs opacity-70" data-testid="type-primary"
                >· {{ 'entityTypes.primary' | transloco }}</span
              >
            }
            @if (writable()) {
              <!-- Reorder + remove are edit-only; a read-only opener sees just the ordered chips. -->
              @if (i > 0) {
                <button
                  type="button"
                  class="leading-none opacity-70 hover:opacity-100 cursor-pointer bg-transparent border-0 text-current"
                  [attr.aria-label]="'entityTypes.moveUpLabel' | transloco: { type: typeLabel(type) }"
                  [attr.data-testid]="'type-move-up-' + type"
                  (click)="moveUp(i)"
                >
                  ↑
                </button>
              }
              @if (i < types().length - 1) {
                <button
                  type="button"
                  class="leading-none opacity-70 hover:opacity-100 cursor-pointer bg-transparent border-0 text-current"
                  [attr.aria-label]="'entityTypes.moveDownLabel' | transloco: { type: typeLabel(type) }"
                  [attr.data-testid]="'type-move-down-' + type"
                  (click)="moveDown(i)"
                >
                  ↓
                </button>
              }
              <!-- The last type can't be removed — every Entity keeps a primary type (typesSchema.min(1)) — and a
                   System-managed type carries no remove at all: the system alone assigns/removes it (ADR-0068). -->
              @if (!isSystemManaged(type)) {
                <button
                  type="button"
                  class="-mr-1 leading-none opacity-70 hover:opacity-100 cursor-pointer bg-transparent border-0 text-current disabled:opacity-30 disabled:cursor-not-allowed"
                  [disabled]="types().length <= 1"
                  [attr.aria-label]="'entityTypes.removeLabel' | transloco: { type: typeLabel(type) }"
                  [attr.data-testid]="'type-remove-' + type"
                  (click)="remove(type)"
                >
                  &times;
                </button>
              }
            }
          </app-chip>
        }

        @if (writable() && addable().length > 0 && !pendingType()) {
          <select
            class="py-1 px-2 text-sm text-ink bg-surface-sunken border border-line rounded-md"
            data-testid="type-add"
            [attr.aria-label]="'entityTypes.addLabel' | transloco"
            (change)="onAdd($event)"
          >
            <option value="">{{ 'entityTypes.addLabel' | transloco }}</option>
            @for (type of addable(); track type) {
              <option [value]="type">{{ typeLabel(type) }}</option>
            }
          </select>
        }
      </div>

      <!-- Add-type prompt: the picked type's unfilled required Fields, offered before the add commits.
           Both add buttons commit it — the prompt informs, it never gates (ADR-0074) — and Cancel
           dismisses it, so a mis-picked type is recoverable without adding then removing it (#338). -->
      @if (pendingType(); as pending) {
        <div
          class="rounded-md border border-line bg-surface-sunken p-3 flex flex-col gap-3"
          data-testid="type-add-prompt"
        >
          <p class="m-0 text-sm text-ink-muted">
            {{ 'entityTypes.requiredHeading' | transloco: { type: typeLabel(pending) } }}
          </p>
          <dl class="grid grid-cols-[minmax(6rem,10rem)_1fr] items-center gap-x-4 gap-y-2 m-0">
            @for (field of pendingFields(); track field.id) {
              <dt class="text-sm text-ink-muted">
                {{ field.label }}<span class="text-danger" aria-hidden="true">&nbsp;*</span>
              </dt>
              <dd class="m-0" [attr.data-testid]="'pending-field-' + field.id">
                <app-field-control
                  [field]="field"
                  [value]="pendingMetadata()[field.id]"
                  [invalid]="!!invalidPendingKeys().has(field.id)"
                  (valueChange)="setPending(field, $event)"
                />
              </dd>
            }
          </dl>
          <div class="flex justify-end gap-2">
            <button
              type="button"
              appButton
              variant="ghost"
              size="sm"
              data-testid="type-add-cancel"
              (click)="cancelAdd()"
            >
              {{ 'common.cancel' | transloco }}
            </button>
            <button type="button" appButton size="sm" data-testid="type-add-bare" (click)="addWithoutFields()">
              {{ 'entityTypes.addWithoutFields' | transloco }}
            </button>
            <button
              type="button"
              appButton
              variant="primary"
              size="sm"
              data-testid="type-add-confirm"
              [attr.aria-disabled]="!pendingValid() || null"
              (click)="confirmAdd()"
            >
              {{ 'entityTypes.confirmAdd' | transloco }}
            </button>
          </div>
        </div>
      }
    </div>
  `,
})
export class EntityTypesEditorComponent {
  private readonly registry = inject(TypeRegistry);
  private readonly transloco = inject(TranslocoService);

  /** The current ordered type set — `types[0]` primary. */
  readonly types = input.required<readonly string[]>();
  /** Current EntityDocument — a re-added type whose values already persist skips the prompt. */
  readonly metadata = input<EntityDocument>({});
  readonly writable = input(true);
  /**
   * Whether adding a type with unfilled required Fields opens the inline prompt. The header binds `true`
   * so the author is told what the new type expects; the create dialog binds `false` and collects the
   * Fields in its own form instead.
   */
  readonly promptOnAdd = input(true);

  readonly typesChange = output<readonly string[]>();
  readonly metadataChange = output<EntityDocument>();

  /** The type the prompt is collecting Fields for, or `null` when no prompt is open. */
  protected readonly pendingType = signal<string | null>(null);
  protected readonly pendingFields = signal<readonly Field[]>([]);
  protected readonly pendingMetadata = signal<EntityDocument>({});

  /** The types the registry calls creatable (ADR-0068) minus those already carried — the add options. */
  protected readonly addable = computed(() =>
    this.registry
      .creatable()
      .filter((d) => !this.types().includes(d.id))
      .map((d) => d.id),
  );

  /** The forward-only reading of the prompt's collected values. */
  private readonly pendingValidation = computed(() =>
    validateFields(this.pendingFields(), this.pendingMetadata(), NO_STRUCTURED_DATA_TYPES),
  );

  /**
   * Whether the prompt's values may be written. Shape violations only (ADR-0074) — an empty `required`
   * Field is a reading, not a refusal, so it never holds the confirm back.
   */
  protected readonly pendingValid = computed(() => this.pendingValidation().ok);

  /** Keys carrying an ill-typed value, so their control can flag itself invalid — an empty one is not. */
  protected readonly invalidPendingKeys = computed(() => new Set(this.pendingValidation().errors.map((e) => e.key)));

  /** A friendly label: a registered type's name (authored, for a user-defined one), else the raw id. */
  protected typeLabel(type: string): string {
    return this.registry.get(type) ? this.registry.chromeLabel(type, 'eyebrow') : type;
  }

  /** The type's tone. An unregistered type hashes its own id, so two unknown ids still read apart. */
  protected toneOf(type: string): ChipTone {
    return typeTone(this.registry.get(type) ?? { id: type });
  }

  /** The type's glyph; an unregistered one takes the generic chrome, as every other surface does. */
  protected iconOf(type: string): IconName {
    return this.registry.resolve(type).icon;
  }

  /** Whether the type is System-managed (ADR-0068) — the system alone assigns/removes it, so no remove renders. */
  protected isSystemManaged(type: string): boolean {
    return !!this.registry.get(type)?.systemManaged;
  }

  /** Swap a type up one place; reaching index 0 re-primaries it. */
  protected moveUp(index: number): void {
    if (index <= 0) return;
    this.swap(index, index - 1);
  }

  protected moveDown(index: number): void {
    if (index >= this.types().length - 1) return;
    this.swap(index, index + 1);
  }

  private swap(a: number, b: number): void {
    const next = [...this.types()];
    [next[a], next[b]] = [next[b], next[a]];
    this.typesChange.emit(next);
  }

  /** Drop a type — the lens only; its EntityDocument persists (CONTEXT.md → Field). Never the last one. */
  protected remove(type: string): void {
    if (this.types().length <= 1) return;
    this.typesChange.emit(this.types().filter((t) => t !== type));
  }

  /** Add the picked type; required Fields the document does not satisfy (when prompting) open the prompt first. */
  protected onAdd(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const type = select.value;
    select.value = '';
    if (!type || this.types().includes(type)) return;
    const required = this.registry.resolveFields([type]).filter((f) => f.required);
    const unsatisfied = required.filter((f) => {
      const reading = validateFields([f], this.metadata(), NO_STRUCTURED_DATA_TYPES);
      // What the prompt has to offer — a Field the document leaves empty or ill-shaped. Nothing here
      // decides whether the type is added; both prompt buttons add it (ADR-0074).
      return !reading.ok || reading.incomplete.length > 0;
    });
    if (unsatisfied.length === 0 || !this.promptOnAdd()) {
      this.typesChange.emit([...this.types(), type]);
      return;
    }
    this.pendingType.set(type);
    this.pendingFields.set(unsatisfied);
    this.pendingMetadata.set({ ...this.metadata() });
  }

  protected setPending(field: Field, value: unknown): void {
    this.pendingMetadata.update((meta) => writeField(meta, field, value));
  }

  /** Commit the add carrying the prompt's collected values: emit the EntityDocument, then the new set. */
  protected confirmAdd(): void {
    const type = this.pendingType();
    if (!type || !this.pendingValid()) return;
    this.metadataChange.emit(this.pendingMetadata());
    this.typesChange.emit([...this.types(), type]);
    this.clearPending();
  }

  /** Add the type carrying none of the prompt's Fields — it lands **Incomplete**, never refused (ADR-0074). */
  protected addWithoutFields(): void {
    const type = this.pendingType();
    if (!type) return;
    this.typesChange.emit([...this.types(), type]);
    this.clearPending();
  }

  /** Dismiss the prompt, adding nothing — the picked type was the wrong one (#338). */
  protected cancelAdd(): void {
    this.clearPending();
  }

  private clearPending(): void {
    this.pendingType.set(null);
    this.pendingFields.set([]);
    this.pendingMetadata.set({});
  }
}
