import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Field, EntityDocument, NO_STRUCTURED_DATA_TYPES, validateFields, writeField } from '@hexly/domain';
import { ButtonComponent, ChipComponent } from '@hexly/web-ui';
import { TypeRegistry } from '../../../entity-types/type-registry';
import { FieldControlComponent } from '@hexly/web-entity';

/**
 * Pick, add, remove, and reorder an Entity's ordered Entity Type set, `types[0]` primary (ADR-0048).
 * Presentational: reads `types`/`metadata`, emits the authored set. Adding a type with unmet required
 * Fields opens an inline prompt ({@link FieldControlComponent} + {@link validateFields}) and holds the type
 * back until they are supplied; removing only drops the lens, leaving its EntityDocument behind
 * (CONTEXT.md → Field).
 */
@Component({
  selector: 'app-entity-types-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, ChipComponent, ButtonComponent, FieldControlComponent],
  template: `
    <div class="flex flex-col gap-3" data-testid="entity-types-editor">
      <div class="flex flex-wrap items-center gap-2">
        @for (type of types(); track type; let i = $index) {
          <app-chip [tone]="i === 0 ? 'gold' : undefined" [attr.data-testid]="'type-chip-' + type">
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

      <!-- Add-type prompt: the picked type's unmet required Fields, collected before the add commits. -->
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
            <button type="button" appButton size="sm" data-testid="type-add-cancel" (click)="cancelAdd()">
              {{ 'common.cancel' | transloco }}
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
   * Whether adding a type with unmet required Fields opens the inline prompt. The header binds `true`
   * so a live autosave never fires an unmet type; the create dialog binds `false` and collects the
   * Fields in its own gated form.
   */
  readonly promptOnAdd = input(true);

  readonly typesChange = output<readonly string[]>();
  readonly metadataChange = output<EntityDocument>();

  /** The type awaiting its required Fields before it is added, or `null` when none is pending. */
  protected readonly pendingType = signal<string | null>(null);
  protected readonly pendingFields = signal<readonly Field[]>([]);
  protected readonly pendingMetadata = signal<EntityDocument>({});

  /**
   * The registered types not already carried — the add picker's options. A System-managed type is never
   * offered: the system alone assigns it (ADR-0068).
   */
  protected readonly addable = computed(() =>
    this.registry
      .all()
      .filter((d) => !d.systemManaged && !this.types().includes(d.id))
      .map((d) => d.id),
  );

  protected readonly pendingValid = computed(
    () => validateFields(this.pendingFields(), this.pendingMetadata(), NO_STRUCTURED_DATA_TYPES).ok,
  );

  /** Keys still failing the forward-only gate, so a control can flag itself invalid. */
  protected readonly invalidPendingKeys = computed(
    () =>
      new Set(
        validateFields(this.pendingFields(), this.pendingMetadata(), NO_STRUCTURED_DATA_TYPES).errors.map((e) => e.key),
      ),
  );

  /** A friendly label: a registered type's name (authored, for a user-defined one), else the raw id. */
  protected typeLabel(type: string): string {
    return this.registry.get(type) ? this.registry.chromeLabel(type, 'eyebrow') : type;
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

  /** Add the picked type; unmet required Fields (when prompting) defer it to the inline prompt. */
  protected onAdd(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const type = select.value;
    select.value = '';
    if (!type || this.types().includes(type)) return;
    const required = this.registry.resolveFields([type]).filter((f) => f.required);
    const unmet = required.filter((f) => !validateFields([f], this.metadata(), NO_STRUCTURED_DATA_TYPES).ok);
    if (unmet.length === 0 || !this.promptOnAdd()) {
      this.typesChange.emit([...this.types(), type]);
      return;
    }
    this.pendingType.set(type);
    this.pendingFields.set(unmet);
    this.pendingMetadata.set({ ...this.metadata() });
  }

  protected setPending(field: Field, value: unknown): void {
    this.pendingMetadata.update((meta) => writeField(meta, field, value));
  }

  /** Commit the pending add once its Fields validate: emit the EntityDocument, then the new set. */
  protected confirmAdd(): void {
    const type = this.pendingType();
    if (!type || !this.pendingValid()) return;
    this.metadataChange.emit(this.pendingMetadata());
    this.typesChange.emit([...this.types(), type]);
    this.clearPending();
  }

  protected cancelAdd(): void {
    this.clearPending();
  }

  private clearPending(): void {
    this.pendingType.set(null);
    this.pendingFields.set([]);
    this.pendingMetadata.set({});
  }
}
