import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  EntityDocument,
  EntityType,
  Field,
  isEmptyFieldValue,
  isStructuredDataType,
  NO_STRUCTURED_DATA_TYPES,
  readField,
  validateFields,
} from '@hexly/domain';
import { EyebrowComponent, SelectComponent } from '@hexly/web-ui';
import { ENTITY_SESSION } from '../models/entity-session';
import { ENTITY_TYPES } from '../models/entity-types';
import { FieldControlComponent } from './field-control.component';

/**
 * The **Details panel** (ADR-0067) — the second universal Panel of the page's Dock, present on every
 * View: the open Entity's **Types** (inline add/remove), its declared **Fields** edited in place
 * (inline attach/detach), and its **untyped** document keys read-only.
 *
 * It edits Fields straight into the one Entity Document every View shares (ADR-0051) and absorbs the
 * type/field management the header's dialogs also offer, all through the `ENTITY_SESSION`/`ENTITY_TYPES`
 * seams — so it never reaches for `apps/web`'s concrete session or registry.
 *
 * The panel itself is always readable; each management affordance is write-gated (ADR-0037), so a
 * read-only session (World/Entity Viewer) sees the same substance with disabled controls and no add,
 * remove, attach, or detach. An untyped key — a value from a missing or disabled Plugin — never hides;
 * it falls through to the read-only plain block, exactly as the fallback Details View shows it.
 */
@Component({
  selector: 'app-details-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EyebrowComponent, FieldControlComponent, SelectComponent, TranslocoPipe],
  host: {
    class: 'flex flex-col gap-1 p-3 overflow-y-auto bg-surface min-h-0 flex-1',
    'data-testid': 'details-panel',
  },
  template: `
    <span appEyebrow mark class="mb-1">{{ 'fields.details.types' | transloco }}</span>

    <div class="flex flex-wrap items-center gap-2">
      @for (type of typeRows(); track type.id) {
        <span
          class="inline-flex items-center gap-1 rounded-full border border-line bg-surface-sunken px-2.5 py-0.5 text-xs text-ink"
          [attr.data-testid]="'detail-type-' + type.id"
        >
          {{ type.label }}
          <!-- Remove is edit-only, never the last type (every Entity keeps a primary, typesSchema.min(1)), and
               never a System-managed type: the system alone assigns/removes it (ADR-0068), so it lists affordance-less. -->
          @if (writable() && typeRows().length > 1 && !type.systemManaged) {
            <button
              type="button"
              class="-mr-1 leading-none opacity-70 hover:opacity-100 cursor-pointer bg-transparent border-0 text-current"
              [attr.aria-label]="'fields.details.removeType' | transloco: { type: type.label }"
              [attr.data-testid]="'detail-type-remove-' + type.id"
              (click)="removeType(type.id)"
            >
              &times;
            </button>
          }
        </span>
      }

      @if (writable() && addableTypes().length > 0) {
        <select
          appSelect
          data-testid="detail-type-add"
          [attr.aria-label]="'fields.details.addType' | transloco"
          (change)="onAddType($event)"
        >
          <option value="">{{ 'fields.details.addType' | transloco }}</option>
          @for (type of addableTypes(); track type.id) {
            <option [value]="type.id">{{ type.label }}</option>
          }
        </select>
      }
    </div>

    <span appEyebrow mark class="mt-3 mb-1">{{ 'fields.details.fields' | transloco }}</span>

    @for (row of fieldRows(); track row.field.id) {
      <div class="flex flex-col gap-1" [attr.data-testid]="'detail-field-' + row.field.id">
        <div class="flex items-center justify-between gap-2">
          <span class="text-sm text-ink-muted">
            {{ row.label }}
            @if (row.field.required) {
              <span class="text-danger" aria-hidden="true">&nbsp;*</span>
            }
          </span>
          <!-- Detach is offered only for an attached extra (a type-default Field is dropped by removing its type),
               and never a System-managed Field: the system alone attaches/detaches it (ADR-0068), so it lists affordance-less. -->
          @if (writable() && row.attached && !row.field.systemManaged) {
            <button
              type="button"
              class="leading-none opacity-70 hover:opacity-100 cursor-pointer bg-transparent border-0 text-ink-muted"
              [attr.aria-label]="'fields.details.detachField' | transloco: { field: row.label }"
              [attr.data-testid]="'detail-field-detach-' + row.field.id"
              (click)="session.detachField(row.field.id)"
            >
              &times;
            </button>
          }
        </div>
        <!-- No control for a Structured Data Type Field — it is edited on its own View (ADR-0050); an
             attached one still shows above as a labelled, detachable row. -->
        @if (!row.structured) {
          <app-field-control
            [field]="row.field"
            [value]="rawValue(row.field)"
            [disabled]="!writable()"
            [invalid]="isInvalid(row.field)"
            [worldId]="worldId()"
            (valueChange)="set(row.field, $event)"
          />
        }
      </div>
    } @empty {
      <p class="text-sm leading-normal text-ink-muted" data-testid="detail-fields-empty">
        {{ 'fields.details.fieldsEmpty' | transloco }}
      </p>
    }

    @if (writable() && attachableFields().length > 0) {
      <select
        appSelect
        class="mt-2"
        data-testid="detail-field-add"
        [attr.aria-label]="'fields.details.attachField' | transloco"
        (change)="onAttach($event)"
      >
        <option value="">{{ 'fields.details.attachField' | transloco }}</option>
        @for (field of attachableFields(); track field.id) {
          <option [value]="field.id">{{ field.label }}</option>
        }
      </select>
    }

    <!-- Whatever the declared Fields don't type — a missing/disabled Plugin's values among them — read-only,
         so nothing is ever hidden (the same substance as the fallback Details View). -->
    @if (plainEntries().length > 0) {
      <span appEyebrow mark class="mt-3 mb-1">{{ 'fields.plainHeading' | transloco }}</span>
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 m-0 text-sm" data-testid="detail-plain">
        @for (entry of plainEntries(); track entry.key) {
          <dt class="font-mono text-xs text-ink-muted break-all">{{ entry.key }}</dt>
          <dd class="m-0 text-ink break-words">{{ entry.value }}</dd>
        }
      </dl>
    }
  `,
})
export class DetailsPanelComponent {
  protected readonly session = inject(ENTITY_SESSION);
  private readonly types = inject(ENTITY_TYPES);
  private readonly transloco = inject(TranslocoService);

  /** A read-only opener manages nothing — controls render disabled, the affordances leave (ADR-0037). */
  protected readonly writable = this.session.writable;

  /** The open Entity's World, scoping an Entity-Link Field picker to same-World targets (#190). */
  protected readonly worldId = computed(() => this.session.current()?.worldId);

  /**
   * The live type set as labelled rows — a registered type by its name, an unknown/disabled one by its raw id.
   * A System-managed type (ADR-0068) still lists here, but flagged so its remove × does not render.
   */
  protected readonly typeRows = computed(() => {
    this.transloco.activeLang(); // re-resolve labels on a language switch
    return this.session
      .types()
      .map((type) => ({ id: type, label: this.typeLabel(type), systemManaged: !!this.types.get(type)?.systemManaged }));
  });

  /**
   * The registered types not already carried — the add picker's offer. A System-managed type is never
   * offered: the system alone assigns it (ADR-0068).
   */
  protected readonly addableTypes = computed(() => {
    this.transloco.activeLang();
    const present = new Set(this.session.types());
    return this.types
      .all()
      .filter((def) => !present.has(def.id) && !def.systemManaged)
      .map((def) => ({ id: def.id, label: this.typeLabel(def.id) }));
  });

  /** The open Entity's effective Field set (ADR-0054): its types' defaults unioned with its attached Fields. */
  private readonly effective = computed(() => this.types.effectiveFields(this.session.types(), this.session.fields()));

  /**
   * Each effective Field as a render row: its label, whether it is an attached extra, and its shape. A
   * Structured Data Type Field is edited on its own View, never a form row (ADR-0050) — so a type-default
   * one (a note's prose) is left off entirely, while an attached one still shows as a detachable label row.
   * A **System-managed** Field (ADR-0068) always lists — affordance-less, no detach — even when it is a
   * structured type-default (the asset-ref on an Asset), because the panel's contract is showing the shape.
   */
  protected readonly fieldRows = computed(() => {
    this.transloco.activeLang();
    const attached = new Set(this.session.fields());
    return this.effective()
      .map((field) => ({
        field,
        label: this.fieldLabel(field),
        attached: attached.has(field.id),
        structured: isStructuredDataType(field.dataType),
      }))
      .filter((row) => !row.structured || row.attached || !!row.field.systemManaged);
  });

  /** Registered Fields the effective set does not already cover — the attach picker's offer. */
  protected readonly attachableFields = computed(() => {
    this.transloco.activeLang();
    return this.types
      .attachableFields(this.session.types(), this.session.fields())
      .map((field) => ({ id: field.id, label: this.fieldLabel(field) }));
  });

  /** The live document. */
  private readonly doc = computed<EntityDocument>(() => this.session.doc());

  /** Document keys no declared Field types — shown read-only as plain metadata (a missing Plugin's included). */
  protected readonly plainEntries = computed(() => {
    const declared = new Set(this.effective().map((field) => field.id));
    return Object.entries(this.doc())
      .filter(([key]) => !declared.has(key))
      .map(([key, value]) => ({ key, value: displayPlain(value) }));
  });

  /** The forward-only validation of the live document, so an invalid control can flag itself (structured excluded). */
  private readonly invalidKeys = computed(() => {
    const reading = validateFields(
      this.effective().filter((field) => !isStructuredDataType(field.dataType)),
      this.doc(),
      NO_STRUCTURED_DATA_TYPES,
    );
    // Recombined (ADR-0074): an unfilled required Field flags exactly as an ill-typed one does.
    return new Set([...reading.errors, ...reading.incomplete].map((error) => error.key));
  });

  protected isInvalid(field: Field): boolean {
    return this.invalidKeys().has(field.id);
  }

  /** The Field's raw value straight off the live document map — the lens the control reads. */
  protected rawValue(field: Field): unknown {
    return readField(this.doc(), field);
  }

  /**
   * Write a value into the one Entity Document every View shares (ADR-0048). Emptying a control keeps the
   * Field **attached** — its key stays `null` (attached-but-empty), not deleted, which is a detach. No-op read-only.
   */
  protected set(field: Field, value: unknown): void {
    if (!this.session.writable()) return;
    this.session.mutate((draft) => {
      draft[field.id] = isEmptyFieldValue(value) ? null : value;
    });
  }

  /** Add the picked type; the select resets so the same option can be re-picked. */
  protected onAddType(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const type = select.value as EntityType;
    select.value = '';
    if (type && !this.session.types().includes(type)) {
      this.session.setTypes([...this.session.types(), type]);
    }
  }

  /** Drop a type — the lens only; its document values persist (CONTEXT.md → Field). Never the last one. */
  protected removeType(type: EntityType): void {
    if (this.session.types().length <= 1) return;
    this.session.setTypes(this.session.types().filter((t) => t !== type));
  }

  protected onAttach(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const id = select.value;
    select.value = '';
    if (id) this.session.attachField(id);
  }

  /** A friendly type label: a registered type's name; an unknown/disabled id (a missing Plugin) verbatim. */
  private typeLabel(type: EntityType): string {
    return this.types.get(type) ? this.types.name(type) : type;
  }

  /** A Field's display name: a plugin's translated `labelKey`, else its authored `label` (ADR-0014). */
  private fieldLabel(field: Field): string {
    return field.labelKey ? this.transloco.translate(field.labelKey) : field.label;
  }
}

/** Flatten a plain document value to a string for read-only display (the domain never interprets it). */
function displayPlain(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(displayPlain).join(', ');
  return JSON.stringify(value) ?? '';
}
