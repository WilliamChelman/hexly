import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  FieldSchema,
  isStructuredDataType,
  Metadata,
  NO_STRUCTURED_DATA_TYPES,
  readField,
  validateFields,
  writeField,
} from '@hexly/domain';
import { EntitySession } from '../services/entity-session';
import { TypeRegistry } from '../../../entity-types/type-registry';
import { FieldControl } from '@hexly/web-entity/controls';

/**
 * The **generic Field View** (`core.view.fields`, ADR-0048, #187): renders an Entity's
 * declared Fields as a typing lens over its one Metadata map, and edits them straight
 * back into it. It does double duty (CONTEXT.md → Type Definition, View):
 *
 * - the renderer for a type that declares Fields (a World-defined type, or a plugin
 *   type that ships no bespoke view) — a labelled, data-type-appropriate control per
 *   Field, writing values into Metadata via {@link EntitySession.mutate}; and
 * - the graceful fallback for an Entity whose type has **no registered view** (a
 *   missing plugin): the unknown type shows as an inert chip and its values fall
 *   through to the plain-Metadata display, nothing lost.
 *
 * It never forks storage: a Field value lives in the same Metadata map Obsidian
 * import/export round-trips (ADR-0033), so removing a type leaves the values intact
 * as plain Metadata. Editing is gated on {@link EntitySession.writable}; a read-only
 * opener sees the same values as static text.
 */
@Component({
  selector: 'app-generic-field-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  imports: [TranslocoPipe, FieldControl],
  template: `
    <div class="absolute inset-0 overflow-y-auto bg-surface-sunken" data-testid="generic-field-view">
      <div class="max-w-[60rem] mx-auto py-6 px-6 flex flex-col gap-6">
        <!-- Inert chips for any type with no registered view — a missing plugin, a World-defined
             type with no code. Purely informational: they carry no behaviour (CONTEXT.md → Tag). -->
        @if (unknownTypes().length > 0) {
          <div class="flex flex-wrap items-center gap-2" data-testid="type-chips">
            @for (type of unknownTypes(); track type) {
              <span
                class="inline-flex items-center rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs text-ink-muted"
                data-testid="type-chip"
              >
                {{ type }}
              </span>
            }
          </div>
        }

        <!-- The declared Fields: one labelled, typed control each. -->
        @if (fields().length > 0) {
          <dl class="grid grid-cols-[minmax(8rem,12rem)_1fr] items-center gap-x-6 gap-y-3 m-0">
            @for (field of fields(); track field.key) {
              <dt class="text-sm text-ink-muted">
                <!-- A plugin's Field ships translated copy under a labelKey; a World Owner's Field
                     shows its authored label verbatim, never as a key (ADR-0014, #191, #200). -->
                {{ field.labelKey ? (field.labelKey | transloco) : field.label }}
                @if (field.required) {
                  <span class="text-danger" aria-hidden="true">&nbsp;*</span>
                }
              </dt>
              <dd class="m-0" [attr.data-testid]="'field-' + field.key">
                <app-field-control
                  [field]="field"
                  [value]="rawValue(field)"
                  [disabled]="!writable()"
                  [invalid]="isInvalid(field)"
                  [worldId]="worldId()"
                  (valueChange)="set(field, $event)"
                />
              </dd>
            }
          </dl>
        }

        <!-- Whatever Metadata the declared Fields don't type: the plain-Metadata display, so an
             absent plugin's values are never hidden — the same read-only rows as EntityMetadata. -->
        @if (plainEntries().length > 0) {
          <div>
            <h2 class="mb-2 text-2xs uppercase tracking-wider text-ink-muted">
              {{ 'fields.plainHeading' | transloco }}
            </h2>
            <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 m-0 text-sm" data-testid="field-plain-metadata">
              @for (entry of plainEntries(); track entry.key) {
                <dt class="font-mono text-xs text-ink-muted break-all">
                  {{ entry.key }}
                </dt>
                <dd class="m-0 text-ink break-words">{{ entry.value }}</dd>
              }
            </dl>
          </div>
        }
      </div>
    </div>
  `,
})
export class GenericFieldView {
  private readonly session = inject(EntitySession);
  private readonly types = inject(TypeRegistry);

  /** A read-only opener edits nothing — the controls render disabled (ADR-0037). */
  protected readonly writable = computed(() => this.session.writable());

  /** The open Entity's World, scoping an Entity-Link Field picker to same-World targets (#190). */
  protected readonly worldId = computed(() => this.session.current()?.worldId);

  /** The union of Field schemas the open Entity's live types declare (primary first, deduped by key). */
  private readonly declared = computed(() => this.types.resolveFields(this.session.types()));

  /**
   * The Fields this view renders a control for: every declared Field except a **Structured** one
   * (ADR-0050), which is edited on its own View, not typed into a form row. Being declared, it is
   * kept out of the plain-Metadata rows below too.
   */
  protected readonly fields = computed(() => this.declared().filter((f) => !isStructuredDataType(f.dataType)));

  /** The live working Metadata — read off the central store's body, written back through mutate. */
  private readonly metadata = computed<Metadata>(() => this.session.body().metadata ?? {});

  /** Types with no registered definition: the missing-plugin fallback, shown as inert chips. */
  protected readonly unknownTypes = computed(() => this.session.types().filter((type) => !this.types.get(type)));

  /** Metadata keys no declared Field types — shown read-only as plain Metadata. */
  protected readonly plainEntries = computed(() => {
    const declared = new Set(this.declared().map((field) => field.key));
    return Object.entries(this.metadata())
      .filter(([key]) => !declared.has(key))
      .map(([key, value]) => ({ key, value: displayPlain(value) }));
  });

  /** The forward-only validation of the live Metadata, so an invalid control can flag itself. */
  private readonly invalidKeys = computed(
    () =>
      new Set(
        validateFields(this.fields(), this.metadata(), NO_STRUCTURED_DATA_TYPES).errors.map((error) => error.key),
      ),
  );

  protected isInvalid(field: FieldSchema): boolean {
    return this.invalidKeys().has(field.key);
  }

  /** The Field's raw value straight off the live Metadata map — the lens the control reads. */
  protected rawValue(field: FieldSchema): unknown {
    return readField(this.metadata(), field);
  }

  /**
   * Write a value into the Metadata map through the central store (ADR-0048): a Field is a lens,
   * so an edit writes the one map every View shares, and {@link writeField} clears the key when the
   * value is emptied rather than leaving a blank behind. No-op for a read-only opener.
   */
  protected set(field: FieldSchema, value: unknown): void {
    if (!this.session.writable()) return;
    this.session.mutate((draft) => {
      draft.metadata = writeField(draft.metadata, field, value);
    });
  }
}

/** Flatten a plain Metadata value to a string for read-only display (the domain never interprets it). */
function displayPlain(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(displayPlain).join(', ');
  return JSON.stringify(value) ?? '';
}
