import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  untracked,
} from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  AvailableType,
  CreateUserDefinedTypeRequest,
  CreateWorldFieldRequest,
  Field,
  isStructuredDataType,
  slugifyFieldSegment,
  UpdateWorldFieldRequest,
  worldTypeIdFromSegment,
  worldTypeSegment,
  worldFieldIdFromSegment,
} from '@hexly/domain';
import { ToasterService, WorldsClient } from '@hexly/web-core';
import { isShownAsView, userTypeViews } from '@hexly/web-entity';
import { ButtonComponent, InputComponent } from '@hexly/web-ui';
import { WorldFieldsLoader } from '../../../../../entity-types/world-fields-loader';
import { TypeRegistry } from '../../../../../entity-types/type-registry';
import { ViewRegistry } from '../../../../../entity-types/view-registry';
import { dataTypeLabel, toFieldDataType } from '../utils/field-data-type';
import { DatatypePickerComponent } from './datatype-picker.component';
import { dataTypeChoices } from '../utils/datatype-choices';
import { FieldRefPickerComponent, FieldChoice } from './field-ref-picker.component';
import { namespaceOf, pluginSourceLabel } from '../utils/source-label';

/** The open type editor's working copy: creating (`editingId === null`) or editing an existing type by id. */
interface Draft {
  editingId: string | null;
  /** The `world.`-less id slug (creating only; immutable when editing). */
  slug: string;
  label: string;
  /** The referenced default Field ids (`fieldRefs`, ADR-0054), in reference order. */
  fieldRefs: string[];
  /** Per referenced **Structured Data Type** Field id: whether its View is placed (on by default, ADR-0050). */
  shownAsView: Record<string, boolean>;
}

/** The inline "new Field" sub-form — authors a World Field the type can then reference (ADR-0054). */
interface FieldDraft {
  /** The `world.`-less key slug, auto-slugged from the label and editable before save (ADR-0056). */
  segment: string;
  /** Once the owner hand-edits the segment, the label stops overwriting it. */
  segmentEdited: boolean;
  label: string;
  kind: string;
  /** Comma-separated enum options; ignored for non-enum kinds. */
  options: string;
}

const BLANK_FIELD: FieldDraft = { segment: '', segmentEdited: false, label: '', kind: 'string', options: '' };

/**
 * The Custom-Type editor form (ADR-0048, ADR-0054): a type is a *semantic bag* that **references**
 * reusable Fields by id (`fieldRefs`), never owns inline schemas. It picks from the World's registered
 * Fields (its own plus enabled plugins') and can mint a new World Field inline. Two signal forms
 * (`@angular/forms/signals`) drive it — the type draft and the inline new-Field sub-form — each seeded
 * from the `type` input (`null` to create). It persists on {@link submit}; the host {@link WorldTypesPanel}
 * hosts it in a dialog, drives Save from the footer via the shared form id, and refreshes on `saved`.
 */
@Component({
  selector: 'app-world-type-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslocoPipe,
    ButtonComponent,
    InputComponent,
    DatatypePickerComponent,
    FieldRefPickerComponent,
    FormField,
  ],
  template: `
    @let d = typeModel();
    <form id="type-editor-form" class="type-editor" data-testid="type-editor" (submit)="onSubmit($event)">
      @if (d.editingId === null) {
        <label class="type-label" for="type-id">{{ 'worldTypes.idLabel' | transloco }}</label>
        <div class="type-id-row">
          <span class="type-id-prefix">{{ 'worldTypes.idPrefix' | transloco }}</span>
          <input appInput id="type-id" data-testid="type-id-input" [formField]="typeForm.slug" />
        </div>
        <p class="type-hint">{{ 'worldTypes.idHint' | transloco }}</p>
      }

      <label class="type-label" for="type-name">{{ 'worldTypes.nameLabel' | transloco }}</label>
      <input appInput id="type-name" data-testid="type-name-input" [formField]="typeForm.label" />

      <h3 class="type-fields-heading">{{ 'worldTypes.referenceHeading' | transloco }}</h3>
      <p class="type-hint">{{ 'worldTypes.referenceHint' | transloco }}</p>
      <app-field-ref-picker
        [fields]="fieldChoices()"
        [selected]="d.fieldRefs"
        (toggled)="toggleRef($event, !d.fieldRefs.includes($event))"
      />
      <!-- A referenced Field of a Structured Data Type places a View; its toggle authors whether. -->
      @if (selectedStructured().length) {
        <div class="type-views">
          @for (f of selectedStructured(); track f.id) {
            <label class="type-flag">
              <input
                type="checkbox"
                [attr.data-testid]="'field-show-as-view-' + f.id"
                [formField]="typeForm.shownAsView[f.id]"
              />
              <span class="type-field-name">{{ f.label }}</span>
              {{ 'worldTypes.fieldShowAsView' | transloco }}
            </label>
          }
        </div>
      }

      @if (newFieldOpen()) {
        @let fd = newFieldModel();
        <fieldset class="newfield" data-testid="newfield-editor">
          <input
            appInput
            [attr.aria-label]="'worldFields.nameLabel' | transloco"
            [placeholder]="'worldFields.nameLabel' | transloco"
            data-testid="newfield-name"
            [formField]="newFieldForm.label"
          />
          <!-- One label-driven key (ADR-0056): the world. slug, auto-filled from the label, editable. -->
          <div class="newfield-key-row">
            <span class="type-id-prefix">{{ 'worldFields.idPrefix' | transloco }}</span>
            <input
              appInput
              [attr.aria-label]="'worldFields.keyLabel' | transloco"
              [placeholder]="'worldFields.keyLabel' | transloco"
              data-testid="newfield-key"
              [formField]="newFieldForm.segment"
              (input)="newFieldForm.segmentEdited().value.set(true)"
            />
          </div>
          <app-datatype-picker
            testid="newfield-kind"
            [options]="newFieldChoices()"
            [kind]="fd.kind"
            (kindChange)="newFieldForm.kind().value.set($event)"
          />
          @if (fd.kind === 'enum') {
            <input
              appInput
              [attr.aria-label]="'worldFields.options' | transloco"
              [placeholder]="'worldFields.optionsHint' | transloco"
              data-testid="newfield-options"
              [formField]="newFieldForm.options"
            />
          }
          <div class="type-actions">
            <button
              appButton
              size="sm"
              variant="primary"
              type="button"
              data-testid="newfield-save"
              [disabled]="!canSaveField()"
              (click)="saveField()"
            >
              {{ 'worldFields.save' | transloco }}
            </button>
            <button appButton size="sm" type="button" data-testid="newfield-cancel" (click)="newFieldOpen.set(false)">
              {{ 'worldFields.cancel' | transloco }}
            </button>
          </div>
        </fieldset>
      } @else {
        <button appButton size="sm" type="button" data-testid="new-field" (click)="startNewField()">
          {{ 'worldTypes.newField' | transloco }}
        </button>
      }

      <div class="form-actions">
        <button appButton type="button" data-testid="type-cancel" (click)="cancelled.emit()">
          {{ 'worldTypes.cancel' | transloco }}
        </button>
        <button appButton variant="primary" type="submit" data-testid="type-save" [disabled]="!canSave()">
          {{ 'worldTypes.save' | transloco }}
        </button>
      </div>
    </form>
  `,
  styles: `
    @reference '#app-styles.css';
    .type-editor {
      @apply flex flex-col gap-2;
    }
    .type-label {
      @apply text-sm font-semibold text-ink-muted;
    }
    .type-id-row {
      @apply flex items-center gap-1;
    }
    .type-id-prefix {
      @apply font-mono text-sm text-ink-muted;
    }
    .type-hint {
      @apply text-2xs text-ink-muted;
    }
    .type-fields-heading {
      @apply mt-2 text-sm font-semibold text-ink-muted;
    }
    .type-flag {
      @apply flex items-center gap-2 text-sm text-ink-muted;
    }
    .type-views {
      @apply mt-1 flex flex-col gap-1 rounded-md border border-line p-3;
    }
    .type-field-name {
      @apply text-ink;
    }
    .newfield {
      @apply mt-1 flex flex-col gap-2 rounded-md border border-line p-3;
    }
    .newfield-key-row {
      @apply flex items-center gap-1;
    }
    .type-actions {
      @apply mt-2 flex items-center gap-2;
    }
    .form-actions {
      @apply mt-2 flex items-center justify-end gap-2;
    }
  `,
})
export class WorldTypeFormComponent {
  readonly worldId = input.required<string>();
  /** The type to edit, or `null` to author a new one. */
  readonly type = input<AvailableType | null>(null);
  /** Fires after a create/update lands, so the host can close the dialog and refresh its list. */
  readonly saved = output<void>();
  /** Fires when the owner dismisses the editor without saving. */
  readonly cancelled = output<void>();

  private readonly worlds = inject(WorldsClient);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);
  private readonly fieldsLoader = inject(WorldFieldsLoader);
  private readonly registry = inject(TypeRegistry);
  private readonly views = inject(ViewRegistry);

  /** The type form model, seeded from the `type` input (reset if a different type is opened). */
  protected readonly typeModel = linkedSignal<Draft>(() => {
    const type = this.type();
    // The registry lookups seed the draft once; untracked so a later Field re-projection can't reset it.
    return untracked(() => {
      if (!type) return { editingId: null, slug: '', label: '', fieldRefs: [], shownAsView: {} };
      // A referenced structured Field's toggle reads back off the type's own view order (ADR-0050).
      const shownAsView: Record<string, boolean> = {};
      for (const id of type.fieldRefs) {
        const field = this.registry.field(id);
        if (field && isStructuredDataType(field.dataType)) shownAsView[id] = isShownAsView(type.views, field);
      }
      return {
        editingId: type.id,
        slug: worldTypeSegment(type.id),
        label: type.label,
        fieldRefs: [...type.fieldRefs],
        shownAsView,
      };
    });
  });
  protected readonly typeForm = form(this.typeModel);

  /** The inline new-Field sub-form: an always-present model, shown/hidden by {@link newFieldOpen}. */
  protected readonly newFieldModel = signal<FieldDraft>(BLANK_FIELD);
  protected readonly newFieldForm = form(this.newFieldModel);
  protected readonly newFieldOpen = signal(false);

  /** The Structured Data Types this build offers in the new-Field sub-form, beside the built-ins. */
  private readonly structuredKinds = computed(() => this.views.offerableDataTypes());

  /** The registered Fields the type may reference (ADR-0054), each with a human Data-Type label. */
  private readonly available = computed(() => {
    this.transloco.activeLang(); // re-resolve labels on a language switch
    const structured = new Map(this.structuredKinds().map((s) => [s.kind, s.labelKey]));
    return this.registry.availableFields().map((field) => ({
      id: field.id,
      label: field.labelKey ? this.transloco.translate(field.labelKey) : field.label,
      structured: isStructuredDataType(field.dataType),
      typeLabel: this.dataTypeLabel(field.dataType.kind, structured),
    }));
  });

  /** The reference picker's rows: each available Field with its source (this World, or a plugin). */
  protected readonly fieldChoices = computed<FieldChoice[]>(() =>
    this.available().map((f) => ({ id: f.id, label: f.label, typeLabel: f.typeLabel, source: this.fieldSource(f.id) })),
  );

  /** The currently-referenced structured Fields — each places a View, so each gets a "show as a view" toggle. */
  protected readonly selectedStructured = computed(() => {
    const refs = this.typeModel().fieldRefs;
    return this.available().filter((f) => f.structured && refs.includes(f.id));
  });

  /** The Data-Type cards the inline new-Field form offers (its built-ins live under `worldTypes.dataType`). */
  protected readonly newFieldChoices = computed(() => {
    this.transloco.activeLang();
    return dataTypeChoices({
      structured: this.structuredKinds(),
      translate: (key) => this.transloco.translate(key),
      builtInPrefix: 'worldTypes.dataType',
      sourceBuiltIn: this.transloco.translate('picker.sourceBuiltIn'),
    });
  });

  /** Save is enabled once the type has a name and (when creating) an id slug. Public: the host's footer reads it. */
  readonly canSave = computed(() => {
    const d = this.typeModel();
    return d.label.trim().length > 0 && (d.editingId !== null || d.slug.trim().length > 0);
  });

  /** The new-Field sub-form saves once it has a label and a derived key slug. */
  protected readonly canSaveField = computed(() => {
    const fd = this.newFieldModel();
    return fd.label.trim().length > 0 && fd.segment.trim().length > 0;
  });

  constructor() {
    // Keep the inline new-Field key slug in sync with its label until hand-edited (ADR-0056)…
    effect(() => {
      const label = this.newFieldForm.label().value();
      untracked(() => {
        const fd = this.newFieldModel();
        if (fd.segmentEdited) return;
        const seg = slugifyFieldSegment(label);
        if (seg !== fd.segment) this.newFieldForm.segment().value.set(seg);
      });
    });
    // …and slugify whatever lands in that key field so the shown key is always the derived one.
    effect(() => {
      const seg = this.newFieldForm.segment().value();
      untracked(() => {
        const slugged = slugifyFieldSegment(seg);
        if (slugged !== seg) this.newFieldForm.segment().value.set(slugged);
      });
    });
  }

  /** Reference or unreference a Field by id; a referenced structured Field defaults its View on (ADR-0054). */
  protected toggleRef(id: string, on: boolean): void {
    const refs = this.typeForm.fieldRefs().value;
    const shown = this.typeForm.shownAsView().value;
    if (on) {
      if (!refs().includes(id)) refs.update((r) => [...r, id]);
      if (shown()[id] === undefined) shown.update((m) => ({ ...m, [id]: true }));
    } else {
      refs.update((r) => r.filter((ref) => ref !== id));
    }
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    this.submit();
  }

  /** Persist the draft; on success emit `saved`. Public so the host's footer Save button can drive it. */
  submit(): void {
    if (!this.canSave()) return;
    const d = this.typeModel();
    // Resolve the referenced Fields to derive the default View order (a structured Field places a View).
    const fields = d.fieldRefs.map((id) => this.registry.field(id)).filter((field): field is Field => !!field);
    const shown = new Set(fields.filter((field) => d.shownAsView[field.id] ?? true).map((field) => field.id));
    const views = userTypeViews(fields, (field) => shown.has(field.id));
    const label = d.label.trim();
    const op$ =
      d.editingId === null
        ? this.worlds.createType(this.worldId(), {
            id: worldTypeIdFromSegment(d.slug.trim()),
            label,
            fieldRefs: d.fieldRefs,
            views,
          } satisfies CreateUserDefinedTypeRequest)
        : this.worlds.updateType(this.worldId(), d.editingId, { label, fieldRefs: d.fieldRefs, views });
    op$.subscribe({
      next: () => this.saved.emit(),
      error: () => this.error(d.editingId === null ? 'worldTypes.createError' : 'worldTypes.updateError'),
    });
  }

  // ── The inline "new Field" sub-form: mint a World Field, then reference it (ADR-0054). ──

  protected startNewField(): void {
    this.newFieldModel.set(BLANK_FIELD);
    this.newFieldOpen.set(true);
  }

  protected saveField(): void {
    const fd = this.newFieldModel();
    if (!this.canSaveField()) return;
    const segment = fd.segment.trim();
    // Same slug the server derives, so this matches the Field it creates (ADR-0056).
    const id = worldFieldIdFromSegment(segment);
    this.worlds
      .createField(this.worldId(), { segment, ...toFieldBody(fd) } satisfies CreateWorldFieldRequest)
      .subscribe({
        next: () => {
          this.newFieldOpen.set(false);
          // Re-project the World's Fields so the registry offers the new one, then reference it.
          this.fieldsLoader.reload();
          this.toggleRef(id, true);
        },
        error: () => this.error('worldFields.createError'),
      });
  }

  /** A Field's source from its id namespace: this World, or a plugin (title-cased) — the picker's filter axis. */
  private fieldSource(id: string): string {
    if (namespaceOf(id) === 'world') return this.transloco.translate('picker.sourceWorld');
    return pluginSourceLabel(id);
  }

  /** A Data Type's display name, shared with the World Fields editor — built-ins under the `worldTypes` catalog. */
  private dataTypeLabel(kind: string, structured: ReadonlyMap<string, string>): string {
    return dataTypeLabel(kind, structured, (key) => this.transloco.translate(key), 'worldTypes.dataType');
  }

  private error(key: string): void {
    this.toaster.show(this.transloco.translate(key), 'error');
  }
}

/** The new-Field sub-form → a key/id-less Field body (ADR-0056). A structured Field is never required or facetable. */
function toFieldBody(fd: FieldDraft): UpdateWorldFieldRequest {
  return {
    label: fd.label.trim(),
    dataType: toFieldDataType(fd.kind, fd.options),
    required: false,
    facetable: false,
  };
}
