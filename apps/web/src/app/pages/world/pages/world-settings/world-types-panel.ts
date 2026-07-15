import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  AvailableType,
  CreateUserDefinedTypeRequest,
  FieldDataType,
  FieldSchema,
  isStructuredKind,
  USER_TYPE_NAMESPACE,
} from '@hexly/domain';
import { ToasterService, WorldsClient } from '@hexly/web-core';
import { produce } from '@hexly/immer';
import { isShownAsView, userTypeViews } from '@hexly/web-entity';
import { Button, Input, Select } from '@hexly/web-ui';
import { WorldTypesLoader } from '../../../../entity-types/world-types-loader';
import { ViewRegistry } from '../../../../entity-types/view-registry';

/** The built-in data-types the authoring UI offers — the subset a code-less type needs (#191). */
const BUILT_IN_KINDS = ['string', 'number', 'boolean', 'date', 'enum'] as const;
type BuiltInKind = (typeof BUILT_IN_KINDS)[number];

/** One Field as the form edits it — flattened so an enum's `options` bind to a single text input. */
interface DraftField {
  key: string;
  label: string;
  /**
   * The picked data-type's kind: a built-in, or a plugin's **Structured Data Type** by its
   * `namespace.id` id (`core.hex-grid`). A bare string — a `<select>` value over both keyspaces.
   */
  kind: string;
  /** Comma-separated enum options; ignored for non-enum kinds. */
  options: string;
  required: boolean;
  facetable: boolean;
  /**
   * **Structured** Fields only: whether this Field's View is placed in the type's view list (on by
   * default, ADR-0050). Off leaves the Field and its value untouched. Ignored for a built-in kind,
   * which has a form row, not a View.
   */
  showAsView: boolean;
  /**
   * The data-type this Field was loaded with, kept whole. The form authors only a `kind` (and an
   * enum's options), so a data-type carrying more — a `list`'s item type, an `entityLink`'s
   * target-type constraint — survives a round trip only by being handed back verbatim. Absent on a
   * Field the author just added.
   */
  stored?: FieldDataType;
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
 * The World-Owner surface for authoring user-defined types (ADR-0048): list, create, rename /
 * re-Field, and delete a World's custom types. Writes are Owner-gated server-side; a refusal toasts
 * and leaves the list untouched. On success it reloads its list and asks {@link WorldTypesLoader} to
 * re-project.
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
              data-testid="field-label"
              (input)="patchField($index, { label: value($event) })"
            />
            <!-- The kind is marked on the option, not bound as the select's [value]: the options are
                 rendered by @for/@if, so a [value] naming one of them runs before it exists and the
                 browser falls back to the first. -->
            <select
              appSelect
              [attr.aria-label]="'worldTypes.fieldType' | transloco"
              data-testid="field-kind"
              (change)="patchField($index, { kind: value($event) })"
            >
              @for (k of builtInKinds; track k) {
                <option [value]="k" [selected]="k === f.kind">{{ 'worldTypes.dataType.' + k | transloco }}</option>
              }
              @for (d of structuredKinds(); track d.kind) {
                <option [value]="d.kind" [selected]="d.kind === f.kind">{{ d.labelKey | transloco }}</option>
              }
              <!-- A kind this form cannot author names itself, rather than leaving the row blank. -->
              @if (unofferedKind(f); as kind) {
                <option [value]="kind" selected>{{ kind }}</option>
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
            <!-- A Field of a Structured Data Type is edited on its own View, so it is never required (nothing
                 collects it) and never a facet (no discrete values to count) — it carries where its
                 View sits instead. -->
            @if (isStructured(f)) {
              <label class="type-flag">
                <input
                  type="checkbox"
                  data-testid="field-show-as-view"
                  [checked]="f.showAsView"
                  (change)="patchField($index, { showAsView: checked($event) })"
                />
                {{ 'worldTypes.fieldShowAsView' | transloco }}
              </label>
            } @else {
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
            }
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
  private readonly views = inject(ViewRegistry);

  protected readonly builtInKinds = BUILT_IN_KINDS;
  protected readonly types = signal<readonly AvailableType[]>([]);
  protected readonly draft = signal<Draft | null>(null);

  /**
   * The **Structured Data Types** this build offers, beside the built-ins. Read off the
   * registered Views, so the picker offers exactly the kinds this build can render.
   */
  protected readonly structuredKinds = computed(() => this.views.offerableDataTypes());

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
      // Each structured Field's toggle reads back off the type's own view order.
      fields: type.fields.map((field) => toDraftField(field, isShownAsView(type.views, field))),
    });
  }

  /** Whether a draft row names a plugin's data-type — the mark being the dot (ADR-0050). */
  protected isStructured(field: DraftField): boolean {
    return isStructuredKind(field.kind);
  }

  /**
   * A row's `kind` when the picker offers no option for it — a `list` or an `entityLink` (authored
   * through the API), or a structured kind whose plugin this build dropped. `null` for a kind on the
   * menu. Such a Field still shows, and round-trips untouched ({@link DraftField.stored}).
   */
  protected unofferedKind(field: DraftField): string | null {
    const offered =
      (BUILT_IN_KINDS as readonly string[]).includes(field.kind) ||
      this.structuredKinds().some((d) => d.kind === field.kind);
    return offered ? null : field.kind;
  }

  /**
   * Every draft edit runs through immer, so a nested change reads as a plain mutation of the draft.
   * Each recipe must return *nothing*: immer reads a returned value as a replacement state and throws
   * when the draft was also mutated — hence the block bodies below, never a bare `Object.assign(…)`
   * or `push(…)` expression (both return a value).
   */
  private mutate(recipe: (draft: Draft) => void): void {
    this.draft.update((d) => (d ? produce(d, recipe) : d));
  }

  protected patch(patch: Partial<Draft>): void {
    this.mutate((d) => {
      Object.assign(d, patch);
    });
  }

  protected patchField(index: number, patch: Partial<DraftField>): void {
    this.mutate((d) => {
      Object.assign(d.fields[index], patch);
    });
  }

  protected addField(): void {
    this.mutate((d) => {
      d.fields.push(blankField());
    });
  }

  protected removeField(index: number): void {
    this.mutate((d) => {
      d.fields.splice(index, 1);
    });
  }

  protected save(event: Event): void {
    event.preventDefault();
    const d = this.draft();
    if (!d || !this.canSave()) return;
    const fields = d.fields.map(toFieldSchema);
    // Fields and view order are always sent together, so a placement never outlives the Field it
    // names. Zipped against the *mapped* Fields, so both agree on a key the form has yet to trim.
    const shown = new Set(fields.filter((_, i) => d.fields[i].showAsView).map((field) => field.key));
    const views = userTypeViews(fields, (field) => shown.has(field.key));
    const label = d.label.trim();
    const op$ =
      d.editingId === null
        ? this.worlds.createType(this.id(), {
            id: `${USER_TYPE_NAMESPACE}.${d.slug.trim()}`,
            label,
            fields,
            // The World Fields editor that authors `fieldRefs` (ADR-0054) is a later step; the inline
            // `fields` path stays the one this panel drives.
            fieldRefs: [],
            views,
          } satisfies CreateUserDefinedTypeRequest)
        : this.worlds.updateType(this.id(), d.editingId, { label, fields, views });
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

/** A fresh, empty Field row — an optional string with no key yet, and shown as a View if made one. */
function blankField(): DraftField {
  return { key: '', label: '', kind: 'string', options: '', required: false, facetable: false, showAsView: true };
}

/**
 * An existing Field schema → the flattened form model. Keeps the whole `dataType` in
 * {@link DraftField.stored}, so a data-type this form cannot rebuild survives an edit of the Field
 * beside it.
 */
function toDraftField(field: FieldSchema, showAsView: boolean): DraftField {
  return {
    key: field.key,
    label: field.label,
    kind: field.dataType.kind,
    options: field.dataType.kind === 'enum' ? field.dataType.options.join(', ') : '',
    required: field.required,
    facetable: field.facetable,
    showAsView,
    stored: field.dataType,
  };
}

/**
 * The form model → a Field schema for the request. A **Field of a Structured Data Type** is neither required nor
 * facetable, whatever a stale draft carries (ADR-0050).
 */
function toFieldSchema(f: DraftField): FieldSchema {
  const structured = isStructuredKind(f.kind);
  return {
    key: f.key.trim(),
    label: f.label.trim(),
    dataType: toDataType(f),
    required: !structured && f.required,
    facetable: !structured && f.facetable,
  };
}

/**
 * The picked kind → a data-type. A kind the author left untouched hands back the stored data-type
 * verbatim, item type and target-type constraint intact.
 */
function toDataType(f: DraftField): FieldDataType {
  if (f.kind === 'enum')
    return {
      kind: 'enum',
      options: f.options
        .split(',')
        .map((option) => option.trim())
        .filter(Boolean),
    };
  if (f.stored?.kind === f.kind) return f.stored;
  if (isStructuredKind(f.kind)) return { kind: f.kind };
  // The remaining built-ins the picker offers are the scalars — one literal kind each, no payload.
  return { kind: f.kind as Exclude<BuiltInKind, 'enum'> };
}
