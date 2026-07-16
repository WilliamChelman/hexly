import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  CreateWorldFieldRequest,
  Field,
  FieldDataType,
  FieldSchema,
  isStructuredKind,
  USER_FIELD_NAMESPACE,
} from '@hexly/domain';
import { ToasterService, WorldsClient } from '@hexly/web-core';
import { produce } from '@hexly/immer';
import { Button, Input, Select } from '@hexly/web-ui';
import { WorldFieldsLoader } from '../../../../entity-types/world-fields-loader';
import { ViewRegistry } from '../../../../entity-types/view-registry';

/** The built-in data-types the authoring UI offers — the subset a code-less Field needs (#230). */
const BUILT_IN_KINDS = ['string', 'number', 'boolean', 'date', 'enum'] as const;
type BuiltInKind = (typeof BUILT_IN_KINDS)[number];

/** The open editor: creating (`editingId === null`) or editing an existing Field by id. */
interface Draft {
  editingId: string | null;
  /** The `world.`-less id slug (creating only; immutable when editing). */
  slug: string;
  key: string;
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
 * The World-Owner surface for authoring reusable **Fields** (ADR-0054, #230), sibling to the World
 * Types editor: list, create, re-body, and delete a World's custom Fields, each carrying its own Data
 * Type (and an enum's options on the Field). Writes are Owner-gated server-side; a refusal toasts and
 * leaves the list untouched. On success it reloads its list and asks {@link WorldFieldsLoader} to
 * re-project so attach pickers and entity editors see the change at once.
 */
@Component({
  selector: 'app-world-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, Button, Input, Select],
  template: `
    <ul class="field-list">
      @for (f of rows(); track f.id) {
        <li class="field-row" [attr.data-testid]="'field-' + f.id">
          <div class="field-meta">
            <span class="field-name">{{ f.label }}</span>
            <span class="field-id">{{ f.id }}</span>
          </div>
          <span class="field-type" [attr.data-testid]="'field-type-' + f.id">{{ f.typeLabel }}</span>
          <button appButton size="sm" [attr.data-testid]="'edit-' + f.id" (click)="startEdit(f.field)">
            {{ 'worldFields.edit' | transloco }}
          </button>
          <button appButton size="sm" danger [attr.data-testid]="'remove-' + f.id" (click)="remove(f.id)">
            {{ 'worldFields.remove' | transloco }}
          </button>
        </li>
      } @empty {
        <li class="field-empty">{{ 'worldFields.empty' | transloco }}</li>
      }
    </ul>

    @if (draft(); as d) {
      <form class="field-editor" data-testid="field-editor" (submit)="save($event)">
        @if (d.editingId === null) {
          <label class="field-label" for="field-id">{{ 'worldFields.idLabel' | transloco }}</label>
          <div class="field-id-row">
            <span class="field-id-prefix">{{ 'worldFields.idPrefix' | transloco }}</span>
            <input
              appInput
              id="field-id"
              data-testid="field-id-input"
              [value]="d.slug"
              (input)="patch({ slug: value($event) })"
            />
          </div>
          <p class="field-hint">{{ 'worldFields.idHint' | transloco }}</p>
        }

        <label class="field-label" for="field-key">{{ 'worldFields.keyLabel' | transloco }}</label>
        <input
          appInput
          id="field-key"
          data-testid="field-key-input"
          [value]="d.key"
          (input)="patch({ key: value($event) })"
        />
        <p class="field-hint">{{ 'worldFields.keyHint' | transloco }}</p>

        <label class="field-label" for="field-name">{{ 'worldFields.nameLabel' | transloco }}</label>
        <input
          appInput
          id="field-name"
          data-testid="field-name-input"
          [value]="d.label"
          (input)="patch({ label: value($event) })"
        />

        <label class="field-label" for="field-type">{{ 'worldFields.typeLabel' | transloco }}</label>
        <!-- The kind is marked on the option, not bound as the select's [value]: the options are
             rendered by @for/@if, so a [value] naming one runs before it exists. -->
        <select appSelect id="field-type" data-testid="field-kind" (change)="patch({ kind: value($event) })">
          @for (k of builtInKinds; track k) {
            <option [value]="k" [selected]="k === d.kind">{{ 'worldFields.dataType.' + k | transloco }}</option>
          }
          @for (s of structuredKinds(); track s.kind) {
            <option [value]="s.kind" [selected]="s.kind === d.kind">{{ s.labelKey | transloco }}</option>
          }
          <!-- A kind this form cannot author names itself, rather than leaving the row blank. -->
          @if (unofferedKind(d); as kind) {
            <option [value]="kind" selected>{{ kind }}</option>
          }
        </select>

        @if (d.kind === 'enum') {
          <input
            appInput
            [attr.aria-label]="'worldFields.options' | transloco"
            [placeholder]="'worldFields.optionsHint' | transloco"
            [value]="d.options"
            data-testid="field-options"
            (input)="patch({ options: value($event) })"
          />
        }

        <!-- A Field of a Structured Data Type is edited on its own View, so it is never required
             (nothing collects it) and never a facet (no discrete values to count). -->
        @if (!isStructured(d)) {
          <label class="field-flag">
            <input
              type="checkbox"
              data-testid="field-required"
              [checked]="d.required"
              (change)="patch({ required: checked($event) })"
            />
            {{ 'worldFields.required' | transloco }}
          </label>
          <label class="field-flag">
            <input
              type="checkbox"
              data-testid="field-facetable"
              [checked]="d.facetable"
              (change)="patch({ facetable: checked($event) })"
            />
            {{ 'worldFields.facetable' | transloco }}
          </label>
        }

        <div class="field-actions">
          <button appButton variant="primary" type="submit" data-testid="field-save" [disabled]="!canSave()">
            {{ 'worldFields.save' | transloco }}
          </button>
          <button appButton type="button" data-testid="field-cancel" (click)="draft.set(null)">
            {{ 'worldFields.cancel' | transloco }}
          </button>
        </div>
      </form>
    } @else {
      <button appButton variant="primary" class="field-new" data-testid="field-new" (click)="startCreate()">
        {{ 'worldFields.add' | transloco }}
      </button>
    }
  `,
  styles: `
    @reference '#app-styles.css';
    .field-list {
      @apply flex flex-col gap-1;
    }
    .field-row {
      @apply flex items-center gap-3 py-1;
    }
    .field-meta {
      @apply flex flex-1 flex-col;
    }
    .field-name {
      @apply text-ink-strong;
    }
    .field-id {
      @apply font-mono text-2xs text-ink-muted;
    }
    .field-type {
      @apply text-2xs text-ink-muted;
    }
    .field-empty {
      @apply py-1 text-sm text-ink-muted;
    }
    .field-editor {
      @apply mt-4 flex flex-col gap-2 border-t border-line pt-4;
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
    .field-hint {
      @apply text-2xs text-ink-muted;
    }
    .field-flag {
      @apply flex items-center gap-1 text-sm text-ink-muted;
    }
    .field-actions {
      @apply mt-2 flex items-center gap-2;
    }
    .field-new {
      @apply mt-4;
    }
  `,
})
export class WorldFieldsPanel implements OnInit {
  readonly id = input.required<string>();

  private readonly worlds = inject(WorldsClient);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);
  private readonly loader = inject(WorldFieldsLoader);
  private readonly views = inject(ViewRegistry);

  protected readonly builtInKinds = BUILT_IN_KINDS;
  protected readonly fields = signal<readonly Field[]>([]);
  protected readonly draft = signal<Draft | null>(null);

  /** The Structured Data Types this build offers, beside the built-ins — read off the registered Views. */
  protected readonly structuredKinds = computed(() => this.views.offerableDataTypes());

  /** The list rows: each Field with a human label for its Data Type (AC — show each Field's Data Type). */
  protected readonly rows = computed(() => {
    this.transloco.activeLang(); // re-resolve data-type labels on a language switch
    const structured = new Map(this.structuredKinds().map((s) => [s.kind, s.labelKey]));
    return this.fields().map((field) => ({
      id: field.id,
      label: field.label,
      typeLabel: this.dataTypeLabel(field.dataType.kind, structured),
      field,
    }));
  });

  /** Save is enabled once the Field has a key, a label, and (when creating) an id slug. */
  protected readonly canSave = computed(() => {
    const d = this.draft();
    return (
      !!d && d.key.trim().length > 0 && d.label.trim().length > 0 && (d.editingId !== null || d.slug.trim().length > 0)
    );
  });

  ngOnInit(): void {
    this.load();
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }
  protected checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  protected startCreate(): void {
    this.draft.set({
      editingId: null,
      slug: '',
      key: '',
      label: '',
      kind: 'string',
      options: '',
      required: false,
      facetable: false,
    });
  }

  protected startEdit(field: Field): void {
    this.draft.set({
      editingId: field.id,
      slug: field.id.slice(`${USER_FIELD_NAMESPACE}.`.length),
      key: field.key,
      label: field.label,
      kind: field.dataType.kind,
      options: field.dataType.kind === 'enum' ? field.dataType.options.join(', ') : '',
      required: field.required,
      facetable: field.facetable,
      stored: field.dataType,
    });
  }

  /** Whether a draft names a plugin's data-type — the mark being the dot (ADR-0050). */
  protected isStructured(d: Draft): boolean {
    return isStructuredKind(d.kind);
  }

  /** A draft's `kind` when the picker offers no option for it — a `list`/`entityLink`, or a dropped plugin's kind. */
  protected unofferedKind(d: Draft): string | null {
    const offered =
      (BUILT_IN_KINDS as readonly string[]).includes(d.kind) || this.structuredKinds().some((s) => s.kind === d.kind);
    return offered ? null : d.kind;
  }

  private mutate(recipe: (draft: Draft) => void): void {
    this.draft.update((d) => (d ? produce(d, recipe) : d));
  }

  protected patch(patch: Partial<Draft>): void {
    this.mutate((d) => {
      Object.assign(d, patch);
    });
  }

  protected save(event: Event): void {
    event.preventDefault();
    const d = this.draft();
    if (!d || !this.canSave()) return;
    const body = toFieldSchema(d);
    const op$ =
      d.editingId === null
        ? this.worlds.createField(this.id(), {
            id: `${USER_FIELD_NAMESPACE}.${d.slug.trim()}`,
            ...body,
          } satisfies CreateWorldFieldRequest)
        : this.worlds.updateField(this.id(), d.editingId, body);
    op$.subscribe({
      next: () => {
        this.draft.set(null);
        this.load();
        this.loader.reload();
      },
      error: () => this.error(d.editingId === null ? 'worldFields.createError' : 'worldFields.updateError'),
    });
  }

  protected remove(fieldId: string): void {
    this.worlds.deleteField(this.id(), fieldId).subscribe({
      next: () => {
        this.load();
        this.loader.reload();
      },
      error: () => this.error('worldFields.removeError'),
    });
  }

  private load(): void {
    this.worlds.fields(this.id()).subscribe({
      next: (fields) => this.fields.set(fields),
      error: () => this.error('worldFields.loadError'),
    });
  }

  /** A Data Type's display name: a built-in's translated label, a structured one's labelKey, else the raw kind. */
  private dataTypeLabel(kind: string, structured: Map<string, string>): string {
    if ((BUILT_IN_KINDS as readonly string[]).includes(kind))
      return this.transloco.translate(`worldFields.dataType.${kind}`);
    const labelKey = structured.get(kind);
    return labelKey ? this.transloco.translate(labelKey) : kind;
  }

  private error(key: string): void {
    this.toaster.show(this.transloco.translate(key), 'error');
  }
}

/**
 * The form model → a Field body (id-less {@link FieldSchema}) for the request. A **Field of a Structured
 * Data Type** is neither required nor facetable, whatever a stale draft carries (ADR-0050).
 */
function toFieldSchema(d: Draft): FieldSchema {
  const structured = isStructuredKind(d.kind);
  return {
    key: d.key.trim(),
    label: d.label.trim(),
    dataType: toDataType(d),
    required: !structured && d.required,
    facetable: !structured && d.facetable,
  };
}

/** The picked kind → a data-type. An untouched kind hands back the stored one verbatim (item/target types intact). */
function toDataType(d: Draft): FieldDataType {
  if (d.kind === 'enum')
    return {
      kind: 'enum',
      options: d.options
        .split(',')
        .map((option) => option.trim())
        .filter(Boolean),
    };
  if (d.stored?.kind === d.kind) return d.stored;
  if (isStructuredKind(d.kind)) return { kind: d.kind };
  return { kind: d.kind as Exclude<BuiltInKind, 'enum'> };
}
