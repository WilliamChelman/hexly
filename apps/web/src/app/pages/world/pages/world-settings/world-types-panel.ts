import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { AvailableType, CreateUserDefinedTypeRequest, FieldSchema, USER_TYPE_NAMESPACE } from '@hexly/domain';
import { ToasterService, WorldsClient } from '@hexly/web-core';
import { Button, Input, Select } from '@hexly/web-ui';
import { WorldTypesLoader } from '../../../../entity-types/world-types-loader';

/** The scalar/enum data-types the authoring UI offers — the subset a code-less type needs (#191). */
const DATA_TYPE_KINDS = ['string', 'number', 'boolean', 'date', 'enum'] as const;
type DataTypeKind = (typeof DATA_TYPE_KINDS)[number];

/** One Field as the form edits it — flattened so an enum's `options` bind to a single text input. */
interface DraftField {
  key: string;
  label: string;
  kind: DataTypeKind;
  /** Comma-separated enum options; ignored for non-enum kinds. */
  options: string;
  required: boolean;
  facetable: boolean;
}

/** The open editor: creating (`editingId === null`) or editing an existing type by id. */
interface Draft {
  editingId: string | null;
  /** The `world.`-less id slug (creating only; immutable when editing). */
  slug: string;
  label: string;
  fields: DraftField[];
}

/**
 * The World-Owner surface for authoring user-defined types (ADR-0048, #191): list, create, rename /
 * re-Field, and delete a World's custom types. Writes are Owner-gated server-side; a refusal toasts
 * and leaves the list untouched. On success it reloads its list and asks {@link WorldTypesLoader} to
 * re-project, so the Type facet and generic Field View reflect the change without a World switch.
 */
@Component({
  selector: 'app-world-types',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, Button, Input, Select],
  template: `
    <ul class="type-list">
      @for (t of types(); track t.id) {
        <li class="type-row" [attr.data-testid]="'type-' + t.id">
          <div class="type-meta">
            <span class="type-name">{{ t.label }}</span>
            <span class="type-id">{{ t.id }}</span>
          </div>
          <span class="type-fieldcount">{{ t.fields.length }}</span>
          <button appButton size="sm" [attr.data-testid]="'edit-' + t.id" (click)="startEdit(t)">
            {{ 'worldTypes.edit' | transloco }}
          </button>
          <button appButton size="sm" danger [attr.data-testid]="'remove-' + t.id" (click)="remove(t.id)">
            {{ 'worldTypes.remove' | transloco }}
          </button>
        </li>
      } @empty {
        <li class="type-empty">{{ 'worldTypes.empty' | transloco }}</li>
      }
    </ul>

    @if (draft(); as d) {
      <form class="type-editor" data-testid="type-editor" (submit)="save($event)">
        @if (d.editingId === null) {
          <label class="type-label" for="type-id">{{ 'worldTypes.idLabel' | transloco }}</label>
          <div class="type-id-row">
            <span class="type-id-prefix">{{ 'worldTypes.idPrefix' | transloco }}</span>
            <input
              appInput
              id="type-id"
              data-testid="type-id-input"
              [value]="d.slug"
              (input)="patch({ slug: value($event) })"
            />
          </div>
          <p class="type-hint">{{ 'worldTypes.idHint' | transloco }}</p>
        }

        <label class="type-label" for="type-name">{{ 'worldTypes.nameLabel' | transloco }}</label>
        <input
          appInput
          id="type-name"
          data-testid="type-name-input"
          [value]="d.label"
          (input)="patch({ label: value($event) })"
        />

        <h3 class="type-fields-heading">{{ 'worldTypes.fieldsHeading' | transloco }}</h3>
        @for (f of d.fields; track $index) {
          <div class="type-field" [attr.data-testid]="'field-' + $index">
            <input
              appInput
              [attr.aria-label]="'worldTypes.fieldKey' | transloco"
              [placeholder]="'worldTypes.fieldKey' | transloco"
              [value]="f.key"
              data-testid="field-key"
              (input)="patchField($index, { key: value($event) })"
            />
            <input
              appInput
              [attr.aria-label]="'worldTypes.fieldName' | transloco"
              [placeholder]="'worldTypes.fieldName' | transloco"
              [value]="f.label"
              (input)="patchField($index, { label: value($event) })"
            />
            <select
              appSelect
              [attr.aria-label]="'worldTypes.fieldType' | transloco"
              [value]="f.kind"
              data-testid="field-kind"
              (change)="patchField($index, { kind: $any(value($event)) })"
            >
              @for (k of dataTypeKinds; track k) {
                <option [value]="k">{{ 'worldTypes.dataType.' + k | transloco }}</option>
              }
            </select>
            @if (f.kind === 'enum') {
              <input
                appInput
                [attr.aria-label]="'worldTypes.fieldOptions' | transloco"
                [placeholder]="'worldTypes.fieldOptionsHint' | transloco"
                [value]="f.options"
                data-testid="field-options"
                (input)="patchField($index, { options: value($event) })"
              />
            }
            <label class="type-flag">
              <input
                type="checkbox"
                [checked]="f.required"
                (change)="patchField($index, { required: checked($event) })"
              />
              {{ 'worldTypes.fieldRequired' | transloco }}
            </label>
            <label class="type-flag">
              <input
                type="checkbox"
                [checked]="f.facetable"
                (change)="patchField($index, { facetable: checked($event) })"
              />
              {{ 'worldTypes.fieldFacetable' | transloco }}
            </label>
            <button
              appButton
              size="sm"
              type="button"
              [attr.aria-label]="'worldTypes.removeField' | transloco"
              (click)="removeField($index)"
            >
              ×
            </button>
          </div>
        } @empty {
          <p class="type-hint">{{ 'worldTypes.noFields' | transloco }}</p>
        }
        <button appButton size="sm" type="button" data-testid="add-field" (click)="addField()">
          {{ 'worldTypes.addField' | transloco }}
        </button>

        <div class="type-actions">
          <button appButton variant="primary" type="submit" data-testid="type-save" [disabled]="!canSave()">
            {{ 'worldTypes.save' | transloco }}
          </button>
          <button appButton type="button" data-testid="type-cancel" (click)="draft.set(null)">
            {{ 'worldTypes.cancel' | transloco }}
          </button>
        </div>
      </form>
    } @else {
      <button appButton variant="primary" class="type-new" data-testid="type-new" (click)="startCreate()">
        {{ 'worldTypes.add' | transloco }}
      </button>
    }
  `,
  styles: `
    @reference '#app-styles.css';
    .type-list {
      @apply flex flex-col gap-1;
    }
    .type-row {
      @apply flex items-center gap-3 py-1;
    }
    .type-meta {
      @apply flex flex-1 flex-col;
    }
    .type-name {
      @apply text-ink-strong;
    }
    .type-id {
      @apply font-mono text-2xs text-ink-muted;
    }
    .type-fieldcount {
      @apply text-2xs text-ink-muted tabular-nums;
    }
    .type-empty {
      @apply py-1 text-sm text-ink-muted;
    }
    .type-editor {
      @apply mt-4 flex flex-col gap-2 border-t border-line pt-4;
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
    .type-field {
      @apply flex flex-wrap items-center gap-2;
    }
    .type-flag {
      @apply flex items-center gap-1 text-sm text-ink-muted;
    }
    .type-actions {
      @apply mt-2 flex items-center gap-2;
    }
    .type-new {
      @apply mt-4;
    }
  `,
})
export class WorldTypesPanel implements OnInit {
  readonly id = input.required<string>();

  private readonly worlds = inject(WorldsClient);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);
  private readonly loader = inject(WorldTypesLoader);

  protected readonly dataTypeKinds = DATA_TYPE_KINDS;
  protected readonly types = signal<readonly AvailableType[]>([]);
  protected readonly draft = signal<Draft | null>(null);

  /** Save is enabled once the type has a name and (when creating) an id slug. */
  protected readonly canSave = computed(() => {
    const d = this.draft();
    return !!d && d.label.trim().length > 0 && (d.editingId !== null || d.slug.trim().length > 0);
  });

  ngOnInit(): void {
    this.load();
  }

  /** The value / checked read helpers for the template's event bindings. */
  protected value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }
  protected checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  protected startCreate(): void {
    this.draft.set({ editingId: null, slug: '', label: '', fields: [] });
  }

  protected startEdit(type: AvailableType): void {
    this.draft.set({
      editingId: type.id,
      // The id is immutable when editing; the slug is shown for reference but not sent.
      slug: type.id.slice(`${USER_TYPE_NAMESPACE}.`.length),
      label: type.label,
      fields: type.fields.map(toDraftField),
    });
  }

  protected patch(patch: Partial<Draft>): void {
    this.draft.update((d) => (d ? { ...d, ...patch } : d));
  }

  protected patchField(index: number, patch: Partial<DraftField>): void {
    this.draft.update((d) =>
      d ? { ...d, fields: d.fields.map((f, i) => (i === index ? { ...f, ...patch } : f)) } : d,
    );
  }

  protected addField(): void {
    this.draft.update((d) =>
      d
        ? {
            ...d,
            fields: [
              ...d.fields,
              { key: '', label: '', kind: 'string', options: '', required: false, facetable: false },
            ],
          }
        : d,
    );
  }

  protected removeField(index: number): void {
    this.draft.update((d) => (d ? { ...d, fields: d.fields.filter((_, i) => i !== index) } : d));
  }

  protected save(event: Event): void {
    event.preventDefault();
    const d = this.draft();
    if (!d || !this.canSave()) return;
    const fields = d.fields.map(toFieldSchema);
    const label = d.label.trim();
    const op$ =
      d.editingId === null
        ? this.worlds.createType(this.id(), {
            id: `${USER_TYPE_NAMESPACE}.${d.slug.trim()}`,
            label,
            fields,
          } satisfies CreateUserDefinedTypeRequest)
        : this.worlds.updateType(this.id(), d.editingId, { label, fields });
    op$.subscribe({
      next: () => {
        this.draft.set(null);
        this.load();
        this.loader.reload();
      },
      error: () => this.error(d.editingId === null ? 'worldTypes.createError' : 'worldTypes.updateError'),
    });
  }

  protected remove(typeId: string): void {
    this.worlds.deleteType(this.id(), typeId).subscribe({
      next: () => {
        this.load();
        this.loader.reload();
      },
      error: () => this.error('worldTypes.removeError'),
    });
  }

  /** Load this World's user-defined types (the available set filtered to the `user` source). */
  private load(): void {
    this.worlds.availableTypes(this.id()).subscribe({
      next: (all) => this.types.set(all.filter((t) => t.source === 'user')),
      error: () => this.error('worldTypes.loadError'),
    });
  }

  private error(key: string): void {
    this.toaster.show(this.transloco.translate(key), 'error');
  }
}

/** An existing Field schema → the flattened form model (enum options joined for the text input). */
function toDraftField(field: FieldSchema): DraftField {
  const kind = field.dataType.kind;
  const supported = (DATA_TYPE_KINDS as readonly string[]).includes(kind) ? (kind as DataTypeKind) : 'string';
  return {
    key: field.key,
    label: field.label,
    kind: supported,
    options: field.dataType.kind === 'enum' ? field.dataType.options.join(', ') : '',
    required: field.required,
    facetable: field.facetable,
  };
}

/** The form model → a Field schema for the request (the server re-validates through the shared Zod). */
function toFieldSchema(f: DraftField): FieldSchema {
  const dataType =
    f.kind === 'enum'
      ? {
          kind: 'enum' as const,
          options: f.options
            .split(',')
            .map((option) => option.trim())
            .filter(Boolean),
        }
      : { kind: f.kind };
  return { key: f.key.trim(), label: f.label.trim(), dataType, required: f.required, facetable: f.facetable };
}
