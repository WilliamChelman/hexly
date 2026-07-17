import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Field } from '@hexly/domain';
import { Chip } from '@hexly/web-ui';
import { TypeRegistry } from '../../../entity-types/type-registry';

/**
 * Attach and detach an Entity's directly-attached **Fields** (`fields[]`, ADR-0054, #229) — the additive
 * instance layer that lets one Entity carry a Field its types never named, without borrowing a Type.
 * Presentational: reads `types`/`fields`, emits an attach/detach by Field id; the {@link TypeRegistry}
 * resolves the attach picker's offer (registered Fields the effective set doesn't already cover) and the
 * chip labels. A detach clears the Field's value from the document — the store's concern, not this view's.
 */
@Component({
  selector: 'app-entity-fields-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, Chip],
  template: `
    <div class="flex flex-col gap-3" data-testid="entity-fields-editor">
      <div class="flex flex-wrap items-center gap-2">
        @for (field of attached(); track field.id) {
          <app-chip [attr.data-testid]="'field-chip-' + field.id">
            {{ field.label }}
            @if (writable()) {
              <button
                type="button"
                class="-mr-1 leading-none opacity-70 hover:opacity-100 cursor-pointer bg-transparent border-0 text-current"
                [attr.aria-label]="'entityFields.removeLabel' | transloco: { field: field.label }"
                [attr.data-testid]="'field-detach-' + field.id"
                (click)="detach.emit(field.id)"
              >
                &times;
              </button>
            }
          </app-chip>
        } @empty {
          <p class="m-0 text-sm text-ink-muted" data-testid="fields-empty">{{ 'entityFields.empty' | transloco }}</p>
        }

        @if (writable() && attachable().length > 0) {
          <select
            class="py-1 px-2 text-sm text-ink bg-surface-sunken border border-line rounded-md"
            data-testid="field-add"
            [attr.aria-label]="'entityFields.addLabel' | transloco"
            (change)="onAttach($event)"
          >
            <option value="">{{ 'entityFields.addLabel' | transloco }}</option>
            @for (field of attachable(); track field.id) {
              <option [value]="field.id">{{ field.label }}</option>
            }
          </select>
        }
      </div>
    </div>
  `,
})
export class EntityFieldsEditor {
  private readonly registry = inject(TypeRegistry);
  private readonly transloco = inject(TranslocoService);

  /** The Entity's current type set — scopes which registered Fields are still attachable. */
  readonly types = input.required<readonly string[]>();
  /** The directly-attached Field ids (`fields[]`), rendered as detachable chips. */
  readonly fields = input.required<readonly string[]>();
  readonly writable = input(true);

  readonly attach = output<string>();
  readonly detach = output<string>();

  /** The attached Fields as chips: resolved for a label, falling back to the raw id when unresolvable (a disabled/absent plugin's Field, degraded). */
  protected readonly attached = computed(() => {
    this.transloco.activeLang(); // reactive dependency: re-resolve labels on a language switch
    return this.fields().map((id) => ({ id, label: this.label(this.registry.field(id)) ?? id }));
  });

  /** Registered Fields still attachable — those whose key the effective set does not already cover. */
  protected readonly attachable = computed(() => {
    this.transloco.activeLang();
    return this.registry.attachableFields(this.types(), this.fields()).map((field) => ({
      id: field.id,
      label: this.label(field) ?? field.id,
    }));
  });

  /** A Field's display name: a plugin's translated `labelKey`, else its authored `label` (ADR-0014). */
  private label(field: Field | undefined): string | undefined {
    if (!field) return undefined;
    return field.labelKey ? this.transloco.translate(field.labelKey) : field.label;
  }

  protected onAttach(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const id = select.value;
    select.value = '';
    if (id) this.attach.emit(id);
  }
}
