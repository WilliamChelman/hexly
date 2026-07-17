import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  output,
  untracked,
} from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  CreateWorldFieldRequest,
  Field,
  FieldDataType,
  isStructuredKind,
  slugifyFieldSegment,
  UpdateWorldFieldRequest,
  USER_FIELD_NAMESPACE,
} from '@hexly/domain';
import { ToasterService, WorldsClient } from '@hexly/web-core';
import { Button, Input } from '@hexly/web-ui';
import { ViewRegistry } from '../../../../../entity-types/view-registry';
import { BUILT_IN_KINDS, toFieldDataType } from '../utils/field-data-type';
import { DatatypePicker } from './datatype-picker';
import { dataTypeChoices } from '../utils/datatype-choices';

/** The open editor's working copy: creating (`editingId === null`) or editing an existing Field by id. */
interface Draft {
  editingId: string | null;
  /** The `world.`-less key slug (ADR-0056): auto-slugged from the label, editable until first save, frozen after. */
  segment: string;
  /** Once the owner hand-edits the segment, the label stops overwriting it (creating only). */
  segmentEdited: boolean;
  label: string;
  /** The picked data-type's kind: a built-in, or a plugin's Structured Data Type by its `namespace.id`. */
  kind: string;
  /** Comma-separated enum options; ignored for non-enum kinds. */
  options: string;
  required: boolean;
  facetable: boolean;
  /** The data-type the Field was loaded with, kept whole so a `list`/`entityLink` survives a round trip. */
  stored?: FieldDataType;
}

/**
 * The Custom-Field editor form (ADR-0054, ADR-0056): authors one reusable Field's label, `world.` key
 * slug, Data Type, and (for a scalar) its `required`/`facetable` flags. A signal form (`@angular/forms/signals`)
 * two-way binds every control to a draft seeded from the `field` input (`null` to create); it persists on
 * {@link submit} — the host {@link WorldFieldsPanel} hosts it in a dialog, drives Save from the footer via the
 * shared form id, and refreshes on `saved`.
 */
@Component({
  selector: 'app-world-field-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, Button, Input, DatatypePicker, FormField],
  template: `
    @let d = draftModel();
    <form id="field-editor-form" class="field-editor" data-testid="field-editor" (submit)="onSubmit($event)">
      <label class="field-label" for="field-name">{{ 'worldFields.nameLabel' | transloco }}</label>
      <input appInput id="field-name" data-testid="field-name-input" [formField]="fieldForm.label" />

      <!-- One label-driven key (ADR-0056): the id and document key are one world. slug, auto-filled
           from the label, editable before the first save and frozen after. -->
      <label class="field-label" for="field-key">{{ 'worldFields.keyLabel' | transloco }}</label>
      @if (d.editingId === null) {
        <div class="field-id-row">
          <span class="field-id-prefix">{{ 'worldFields.idPrefix' | transloco }}</span>
          <!-- Any keystroke here latches the key off the label; the value slugifies via an effect. -->
          <input
            appInput
            id="field-key"
            data-testid="field-key-input"
            [formField]="fieldForm.segment"
            (input)="fieldForm.segmentEdited().value.set(true)"
          />
        </div>
        <p class="field-hint">{{ 'worldFields.keyHint' | transloco }}</p>
      } @else {
        <p class="field-id" data-testid="field-key-frozen">{{ d.editingId }}</p>
        <p class="field-hint">{{ 'worldFields.keyFrozenHint' | transloco }}</p>
      }

      <span class="field-label">{{ 'worldFields.typeLabel' | transloco }}</span>
      <app-datatype-picker
        testid="field-kind"
        [options]="dataTypeChoices()"
        [kind]="d.kind"
        (kindChange)="fieldForm.kind().value.set($event)"
      />

      @if (d.kind === 'enum') {
        <input
          appInput
          [attr.aria-label]="'worldFields.options' | transloco"
          [placeholder]="'worldFields.optionsHint' | transloco"
          data-testid="field-options"
          [formField]="fieldForm.options"
        />
      }

      <!-- A Field of a Structured Data Type is edited on its own View, so it is never required
           (nothing collects it) and never a facet (no discrete values to count). -->
      @if (!isStructured(d)) {
        <label class="field-flag">
          <input type="checkbox" data-testid="field-required" [formField]="fieldForm.required" />
          {{ 'worldFields.required' | transloco }}
        </label>
        <label class="field-flag">
          <input type="checkbox" data-testid="field-facetable" [formField]="fieldForm.facetable" />
          {{ 'worldFields.facetable' | transloco }}
        </label>
      }

      <div class="form-actions">
        <button appButton type="button" data-testid="field-cancel" (click)="cancelled.emit()">
          {{ 'worldFields.cancel' | transloco }}
        </button>
        <button appButton variant="primary" type="submit" data-testid="field-save" [disabled]="!canSave()">
          {{ 'worldFields.save' | transloco }}
        </button>
      </div>
    </form>
  `,
  styles: `
    @reference '#app-styles.css';
    .field-editor {
      @apply flex flex-col gap-2;
    }
    .field-label {
      @apply text-sm font-semibold text-ink-muted;
    }
    .field-id-row {
      @apply flex items-center gap-1;
    }
    .field-id-prefix {
      @apply font-mono text-sm text-ink-muted;
    }
    .field-id {
      @apply font-mono text-2xs text-ink-muted;
    }
    .field-hint {
      @apply text-2xs text-ink-muted;
    }
    .field-flag {
      @apply flex items-center gap-1 text-sm text-ink-muted;
    }
    .form-actions {
      @apply mt-2 flex items-center justify-end gap-2;
    }
  `,
})
export class WorldFieldForm {
  readonly worldId = input.required<string>();
  /** The Field to edit, or `null` to author a new one. */
  readonly field = input<Field | null>(null);
  /** Fires after a create/update lands, so the host can close the dialog and refresh its list. */
  readonly saved = output<void>();
  /** Fires when the owner dismisses the editor without saving. */
  readonly cancelled = output<void>();

  private readonly worlds = inject(WorldsClient);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);
  private readonly views = inject(ViewRegistry);

  /** The form model, seeded from the `field` input (reset if a different Field is opened). */
  protected readonly draftModel = linkedSignal<Draft>(() => {
    const field = this.field();
    return field
      ? {
          editingId: field.id,
          segment: field.id.slice(`${USER_FIELD_NAMESPACE}.`.length),
          segmentEdited: true,
          label: field.label,
          kind: field.dataType.kind,
          options: field.dataType.kind === 'enum' ? field.dataType.options.join(', ') : '',
          required: field.required,
          facetable: field.facetable,
          stored: field.dataType,
        }
      : {
          editingId: null,
          segment: '',
          segmentEdited: false,
          label: '',
          kind: 'string',
          options: '',
          required: false,
          facetable: false,
        };
  });
  protected readonly fieldForm = form(this.draftModel);

  private readonly structuredKinds = computed(() => this.views.offerableDataTypes());

  /** The Data-Type cards the picker shows: built-ins, plugins' structured types, and the draft's own unoffered kind. */
  protected readonly dataTypeChoices = computed(() => {
    this.transloco.activeLang(); // re-resolve labels on a language switch
    return dataTypeChoices({
      structured: this.structuredKinds(),
      unoffered: this.unofferedKind(this.draftModel()),
      translate: (key) => this.transloco.translate(key),
      builtInPrefix: 'worldFields.dataType',
      sourceBuiltIn: this.transloco.translate('picker.sourceBuiltIn'),
    });
  });

  /** Save is enabled once the Field has a label and (when creating) a derived key slug. Public: the host's footer reads it. */
  readonly canSave = computed(() => {
    const d = this.draftModel();
    return d.label.trim().length > 0 && (d.editingId !== null || d.segment.trim().length > 0);
  });

  constructor() {
    // Keep the key slug in sync with the label until the owner hand-edits it (ADR-0056, creating only).
    effect(() => {
      const label = this.fieldForm.label().value();
      untracked(() => {
        const d = this.draftModel();
        if (d.editingId !== null || d.segmentEdited) return;
        const seg = slugifyFieldSegment(label);
        if (seg !== d.segment) this.fieldForm.segment().value.set(seg);
      });
    });
    // Slugify whatever lands in the key field so the shown key is always the derived one.
    effect(() => {
      const seg = this.fieldForm.segment().value();
      untracked(() => {
        if (this.draftModel().editingId !== null) return;
        const slugged = slugifyFieldSegment(seg);
        if (slugged !== seg) this.fieldForm.segment().value.set(slugged);
      });
    });
  }

  protected isStructured(d: Draft): boolean {
    return isStructuredKind(d.kind);
  }

  /** A draft's `kind` when the picker offers no option for it — a `list`/`entityLink`, or a dropped plugin's kind. */
  private unofferedKind(d: Draft): string | null {
    const offered =
      (BUILT_IN_KINDS as readonly string[]).includes(d.kind) || this.structuredKinds().some((s) => s.kind === d.kind);
    return offered ? null : d.kind;
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    this.submit();
  }

  /** Persist the draft; on success emit `saved`. Public so the host's footer Save button can drive it. */
  submit(): void {
    if (!this.canSave()) return;
    const d = this.draftModel();
    const body = toFieldBody(d);
    const op$ =
      d.editingId === null
        ? this.worlds.createField(this.worldId(), {
            segment: d.segment.trim(),
            ...body,
          } satisfies CreateWorldFieldRequest)
        : this.worlds.updateField(this.worldId(), d.editingId, body);
    op$.subscribe({
      next: () => this.saved.emit(),
      error: () => this.error(d.editingId === null ? 'worldFields.createError' : 'worldFields.updateError'),
    });
  }

  private error(key: string): void {
    this.toaster.show(this.transloco.translate(key), 'error');
  }
}

/**
 * The form model → a key/id-less Field body (ADR-0056; the server derives the key). A **Field of a
 * Structured Data Type** is never required or facetable (ADR-0050).
 */
function toFieldBody(d: Draft): UpdateWorldFieldRequest {
  const structured = isStructuredKind(d.kind);
  return {
    label: d.label.trim(),
    dataType: toFieldDataType(d.kind, d.options, d.stored),
    required: !structured && d.required,
    facetable: !structured && d.facetable,
  };
}
