import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { EntityLinkValue, entityLinkValueSchema, EntitySummary, FieldSchema } from '@hexly/domain';
import { EntitySearchPicker } from '@hexly/web-ui';

/**
 * One data-type-appropriate control for a typed Field (ADR-0048). Reads a raw EntityDocument `value`, emits
 * the edited one coerced to the Field's data-type.
 */
@Component({
  selector: 'app-field-control',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  imports: [TranslocoPipe, EntitySearchPicker],
  template: `
    @switch (field().dataType.kind) {
      @case ('entityLink') {
        <div class="flex flex-col gap-1.5" [attr.data-testid]="'entity-link-field-' + field().key">
          <!-- Render the last-known name, so a deleted/hidden target stays legible, never erroring. -->
          @if (link(); as current) {
            <div class="flex items-center gap-2">
              <span class="text-sm text-ink" data-testid="entity-link-value">{{
                current.label || current.entityId
              }}</span>
              @if (!disabled()) {
                <button
                  type="button"
                  class="text-xs text-ink-muted hover:text-danger"
                  data-testid="entity-link-clear"
                  (click)="valueChange.emit(undefined)"
                >
                  ✕
                </button>
              }
            </div>
          }
          @if (!disabled()) {
            @if (picking()) {
              <app-entity-search-picker
                testid="entity-link-picker"
                [query]="query()"
                [worldId]="worldId()"
                [types]="targetTypes()"
                (queryChange)="query.set($event)"
                (pick)="pickLink($event)"
              />
            } @else {
              <button
                type="button"
                class="self-start rounded border border-line bg-surface px-2 py-1 text-sm text-ink-muted hover:text-ink"
                data-testid="entity-link-open"
                [attr.aria-invalid]="invalid() || null"
                (click)="picking.set(true)"
              >
                {{ (link() ? 'fields.entityLink.change' : 'fields.entityLink.set') | transloco }}
              </button>
            }
          }
        </div>
      }
      @case ('boolean') {
        <input
          type="checkbox"
          [checked]="value() === true"
          [disabled]="disabled()"
          (change)="valueChange.emit(checkboxChecked($event))"
        />
      }
      @case ('enum') {
        <select
          class="w-full rounded border border-line bg-surface px-2 py-1 text-sm"
          [disabled]="disabled()"
          [attr.aria-invalid]="invalid() || null"
          (change)="valueChange.emit(selectValue($event))"
        >
          <option value=""></option>
          @for (option of options(); track option) {
            <option [value]="option" [selected]="option === stringValue()">
              {{ option }}
            </option>
          }
        </select>
      }
      @case ('date') {
        <input
          type="date"
          class="rounded border border-line bg-surface px-2 py-1 text-sm"
          [value]="stringValue()"
          [disabled]="disabled()"
          [attr.aria-invalid]="invalid() || null"
          (change)="valueChange.emit(inputValue($event))"
        />
      }
      @case ('number') {
        <input
          type="number"
          class="w-full rounded border border-line bg-surface px-2 py-1 text-sm"
          [value]="stringValue()"
          [disabled]="disabled()"
          [attr.aria-invalid]="invalid() || null"
          (input)="valueChange.emit(numberValue($event))"
        />
      }
      @default {
        <!-- string, and list<scalar> as a comma-separated text field. -->
        <input
          type="text"
          class="w-full rounded border border-line bg-surface px-2 py-1 text-sm"
          [value]="stringValue()"
          [disabled]="disabled()"
          [attr.aria-invalid]="invalid() || null"
          (input)="valueChange.emit(typedValue(inputValue($event)))"
        />
      }
    }
  `,
})
export class FieldControl {
  readonly field = input.required<FieldSchema>();
  /** The Field's current raw EntityDocument value (a lens, never copied — CONTEXT.md → Field). */
  readonly value = input<unknown>();
  readonly disabled = input(false);
  /** Flags the control invalid (forward-only validation), driving `aria-invalid`. */
  readonly invalid = input(false);
  /** The open Entity's World, scoping an `entityLink` picker to same-World targets (#190). */
  readonly worldId = input<string | undefined>(undefined);
  readonly valueChange = output<unknown>();

  /** Whether the Entity-Link picker is open; a set/change click opens it, a pick closes it. */
  protected readonly picking = signal(false);
  /** The Entity-Link picker's controlled search query (the picker owns nothing itself). */
  protected readonly query = signal('');

  /** The current Entity-Link value parsed off the raw EntityDocument, or `null` for an unset/ill-typed one. */
  protected readonly link = computed<EntityLinkValue | null>(
    () => entityLinkValueSchema.safeParse(this.value()).data ?? null,
  );

  /** The Entity-Link Field's target-type constraint, forwarded to the picker (empty → any Type). */
  protected targetTypes(): readonly string[] | undefined {
    const dataType = this.field().dataType;
    return dataType.kind === 'entityLink' ? dataType.targetTypes : undefined;
  }

  /** Commit a picked Entity as the link value — its id plus a name snapshot (the dangling fallback). */
  protected pickLink(entity: EntitySummary): void {
    this.valueChange.emit({ entityId: entity.id, label: entity.name } satisfies EntityLinkValue);
    this.picking.set(false);
    this.query.set('');
  }

  /** The options of an `enum` Field, for its `<select>`; empty for any other data-type. */
  protected options(): readonly string[] {
    const dataType = this.field().dataType;
    return dataType.kind === 'enum' ? dataType.options : [];
  }

  /** The Field's value rendered as an input string — a list joins on `, `, a scalar stringifies. */
  protected stringValue(): string {
    const value = this.value();
    if (value == null) return '';
    if (Array.isArray(value)) return value.join(', ');
    return String(value);
  }

  /** Coerce a text input to the Field's data-type: a `list` splits on commas, a scalar passes through. */
  protected typedValue(raw: string): unknown {
    const dataType = this.field().dataType;
    if (dataType.kind !== 'list') return raw;
    const itemKind = dataType.of.kind;
    return raw
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map((part) => (itemKind === 'number' ? Number(part) : part));
  }

  /** An empty number input clears the Field; otherwise it becomes a real `number`. */
  protected numberValue(event: Event): number | undefined {
    const raw = this.inputValue(event);
    return raw === '' ? undefined : Number(raw);
  }

  protected inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected selectValue(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }

  protected checkboxChecked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }
}
