import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  AvailableType,
  CreateUserDefinedTypeRequest,
  CreateWorldFieldRequest,
  Field,
  isStructuredDataType,
  slugifyFieldSegment,
  UpdateWorldFieldRequest,
  USER_TYPE_NAMESPACE,
  worldFieldIdFromSegment,
} from '@hexly/domain';
import { ToasterService, WorldsClient } from '@hexly/web-core';
import { produce } from '@hexly/immer';
import { isShownAsView, userTypeViews } from '@hexly/web-entity';
import { Button, Input, Select } from '@hexly/web-ui';
import { WorldTypesLoader } from '../../../../entity-types/world-types-loader';
import { WorldFieldsLoader } from '../../../../entity-types/world-fields-loader';
import { TypeRegistry } from '../../../../entity-types/type-registry';
import { ViewRegistry } from '../../../../entity-types/view-registry';
import { BUILT_IN_KINDS, dataTypeLabel, toFieldDataType } from './field-data-type';

/** The open type editor: creating (`editingId === null`) or editing an existing type by id. */
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

/**
 * The World-Owner surface for authoring user-defined types (ADR-0048, ADR-0054): a type is a *semantic
 * bag* that **references** reusable Fields by id (`fieldRefs`), never owns inline schemas. The editor
 * picks from the World's registered Fields (its own, authored in the World Fields editor, plus the
 * enabled plugins') and can mint a new World Field inline. Writes are Owner-gated server-side; a refusal
 * toasts and leaves the list untouched. On success it reloads its list and asks {@link WorldTypesLoader}
 * to re-project.
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
          <span class="type-fieldcount">{{ t.fieldRefs.length }}</span>
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

        <h3 class="type-fields-heading">{{ 'worldTypes.referenceHeading' | transloco }}</h3>
        <p class="type-hint">{{ 'worldTypes.referenceHint' | transloco }}</p>
        @for (f of available(); track f.id) {
          <div class="type-field" [attr.data-testid]="'field-ref-' + f.id">
            <label class="type-flag">
              <input
                type="checkbox"
                [attr.data-testid]="'field-ref-checkbox-' + f.id"
                [checked]="d.fieldRefs.includes(f.id)"
                (change)="toggleRef(f.id, checked($event))"
              />
              <span class="type-field-name">{{ f.label }}</span>
              <span class="type-field-id">{{ f.id }} · {{ f.typeLabel }}</span>
            </label>
            <!-- A referenced Field of a Structured Data Type places a View; the toggle authors where. -->
            @if (d.fieldRefs.includes(f.id) && f.structured) {
              <label class="type-flag">
                <input
                  type="checkbox"
                  [attr.data-testid]="'field-show-as-view-' + f.id"
                  [checked]="d.shownAsView[f.id] ?? true"
                  (change)="setShowAsView(f.id, checked($event))"
                />
                {{ 'worldTypes.fieldShowAsView' | transloco }}
              </label>
            }
          </div>
        } @empty {
          <p class="type-hint" data-testid="no-fields-available">{{ 'worldTypes.noFieldsAvailable' | transloco }}</p>
        }

        @if (fieldDraft(); as fd) {
          <fieldset class="newfield" data-testid="newfield-editor">
            <input
              appInput
              [attr.aria-label]="'worldFields.nameLabel' | transloco"
              [placeholder]="'worldFields.nameLabel' | transloco"
              [value]="fd.label"
              data-testid="newfield-name"
              (input)="editFieldLabel(value($event))"
            />
            <!-- One label-driven key (ADR-0056): the world. slug, auto-filled from the label, editable. -->
            <div class="newfield-key-row">
              <span class="type-id-prefix">{{ 'worldFields.idPrefix' | transloco }}</span>
              <input
                appInput
                [attr.aria-label]="'worldFields.keyLabel' | transloco"
                [placeholder]="'worldFields.keyLabel' | transloco"
                [value]="fd.segment"
                data-testid="newfield-key"
                (input)="editFieldSegment(value($event))"
              />
            </div>
            <select
              appSelect
              [attr.aria-label]="'worldFields.typeLabel' | transloco"
              data-testid="newfield-kind"
              (change)="patchFieldDraft({ kind: value($event) })"
            >
              @for (k of builtInKinds; track k) {
                <option [value]="k" [selected]="k === fd.kind">{{ 'worldTypes.dataType.' + k | transloco }}</option>
              }
              @for (s of structuredKinds(); track s.kind) {
                <option [value]="s.kind" [selected]="s.kind === fd.kind">{{ s.labelKey | transloco }}</option>
              }
            </select>
            @if (fd.kind === 'enum') {
              <input
                appInput
                [attr.aria-label]="'worldFields.options' | transloco"
                [placeholder]="'worldFields.optionsHint' | transloco"
                [value]="fd.options"
                data-testid="newfield-options"
                (input)="patchFieldDraft({ options: value($event) })"
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
              <button appButton size="sm" type="button" data-testid="newfield-cancel" (click)="fieldDraft.set(null)">
                {{ 'worldFields.cancel' | transloco }}
              </button>
            </div>
          </fieldset>
        } @else {
          <button appButton size="sm" type="button" data-testid="new-field" (click)="startNewField()">
            {{ 'worldTypes.newField' | transloco }}
          </button>
        }

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
      @apply flex flex-wrap items-center gap-3;
    }
    .type-flag {
      @apply flex items-center gap-2 text-sm text-ink-muted;
    }
    .type-field-name {
      @apply text-ink;
    }
    .type-field-id {
      @apply font-mono text-2xs text-ink-muted;
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
  private readonly fieldsLoader = inject(WorldFieldsLoader);
  private readonly registry = inject(TypeRegistry);
  private readonly views = inject(ViewRegistry);

  protected readonly builtInKinds = BUILT_IN_KINDS;
  protected readonly types = signal<readonly AvailableType[]>([]);
  protected readonly draft = signal<Draft | null>(null);
  protected readonly fieldDraft = signal<FieldDraft | null>(null);

  /** The Structured Data Types this build offers in the new-Field sub-form, beside the built-ins. */
  protected readonly structuredKinds = computed(() => this.views.offerableDataTypes());

  /** The registered Fields the type may reference (ADR-0054), each with a human Data-Type label. */
  protected readonly available = computed(() => {
    this.transloco.activeLang(); // re-resolve labels on a language switch
    const structured = new Map(this.structuredKinds().map((s) => [s.kind, s.labelKey]));
    return this.registry.availableFields().map((field) => ({
      id: field.id,
      label: field.labelKey ? this.transloco.translate(field.labelKey) : field.label,
      structured: isStructuredDataType(field.dataType),
      typeLabel: this.dataTypeLabel(field.dataType.kind, structured),
    }));
  });

  /** Save is enabled once the type has a name and (when creating) an id slug. */
  protected readonly canSave = computed(() => {
    const d = this.draft();
    return !!d && d.label.trim().length > 0 && (d.editingId !== null || d.slug.trim().length > 0);
  });

  /** The new-Field sub-form saves once it has a label and a derived key slug. */
  protected readonly canSaveField = computed(() => {
    const fd = this.fieldDraft();
    return !!fd && fd.label.trim().length > 0 && fd.segment.trim().length > 0;
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
    this.draft.set({ editingId: null, slug: '', label: '', fieldRefs: [], shownAsView: {} });
    this.fieldDraft.set(null);
  }

  protected startEdit(type: AvailableType): void {
    // A referenced structured Field's toggle reads back off the type's own view order (ADR-0050).
    const shownAsView: Record<string, boolean> = {};
    for (const id of type.fieldRefs) {
      const field = this.registry.field(id);
      if (field && isStructuredDataType(field.dataType)) shownAsView[id] = isShownAsView(type.views, field);
    }
    this.draft.set({
      editingId: type.id,
      slug: type.id.slice(`${USER_TYPE_NAMESPACE}.`.length),
      label: type.label,
      fieldRefs: [...type.fieldRefs],
      shownAsView,
    });
    this.fieldDraft.set(null);
  }

  /**
   * Every draft edit runs through immer, so a nested change reads as a plain mutation. Each recipe must
   * return *nothing*: immer reads a returned value as a replacement state and throws when the draft was
   * also mutated — hence the block bodies in {@link toggleRef}/{@link setShowAsView}, never a bare
   * `push(…)`/`Object.assign(…)` expression (both return a value).
   */
  private mutate(recipe: (draft: Draft) => void): void {
    this.draft.update((d) => (d ? produce(d, recipe) : d));
  }

  protected patch(patch: Partial<Draft>): void {
    this.mutate((d) => {
      Object.assign(d, patch);
    });
  }

  /** Reference or unreference a Field by id; a referenced structured Field defaults its View on. */
  protected toggleRef(id: string, on: boolean): void {
    this.mutate((d) => {
      if (on) {
        if (!d.fieldRefs.includes(id)) d.fieldRefs.push(id);
        if (d.shownAsView[id] === undefined) d.shownAsView[id] = true;
      } else {
        d.fieldRefs = d.fieldRefs.filter((ref) => ref !== id);
      }
    });
  }

  protected setShowAsView(id: string, on: boolean): void {
    this.mutate((d) => {
      d.shownAsView[id] = on;
    });
  }

  protected save(event: Event): void {
    event.preventDefault();
    const d = this.draft();
    if (!d || !this.canSave()) return;
    // Resolve the referenced Fields to derive the default View order (a structured Field places a View).
    const fields = d.fieldRefs.map((id) => this.registry.field(id)).filter((field): field is Field => !!field);
    const shown = new Set(fields.filter((field) => d.shownAsView[field.id] ?? true).map((field) => field.id));
    const views = userTypeViews(fields, (field) => shown.has(field.id));
    const label = d.label.trim();
    const op$ =
      d.editingId === null
        ? this.worlds.createType(this.id(), {
            id: `${USER_TYPE_NAMESPACE}.${d.slug.trim()}`,
            label,
            fieldRefs: d.fieldRefs,
            views,
          } satisfies CreateUserDefinedTypeRequest)
        : this.worlds.updateType(this.id(), d.editingId, { label, fieldRefs: d.fieldRefs, views });
    op$.subscribe({
      next: () => {
        this.draft.set(null);
        this.load();
        this.loader.reload();
      },
      error: () => this.error(d.editingId === null ? 'worldTypes.createError' : 'worldTypes.updateError'),
    });
  }

  // ── The inline "new Field" sub-form: mint a World Field, then reference it (ADR-0054). ──

  protected startNewField(): void {
    this.fieldDraft.set({ segment: '', segmentEdited: false, label: '', kind: 'string', options: '' });
  }

  protected patchFieldDraft(patch: Partial<FieldDraft>): void {
    this.fieldDraft.update((fd) => (fd ? { ...fd, ...patch } : fd));
  }

  /** Edit the new Field's label; keep its key slug in sync until the owner hand-edits it (ADR-0056). */
  protected editFieldLabel(label: string): void {
    this.fieldDraft.update((fd) =>
      fd ? { ...fd, label, segment: fd.segmentEdited ? fd.segment : slugifyFieldSegment(label) } : fd,
    );
  }

  /** Hand-edit the new Field's key slug; slug it live so the shown key is the derived one. */
  protected editFieldSegment(segment: string): void {
    this.fieldDraft.update((fd) => (fd ? { ...fd, segment: slugifyFieldSegment(segment), segmentEdited: true } : fd));
  }

  protected saveField(): void {
    const fd = this.fieldDraft();
    if (!fd || !this.canSaveField()) return;
    const segment = fd.segment.trim();
    // Same slug the server derives, so this matches the Field it creates (ADR-0056).
    const id = worldFieldIdFromSegment(segment);
    this.worlds.createField(this.id(), { segment, ...toFieldBody(fd) } satisfies CreateWorldFieldRequest).subscribe({
      next: () => {
        this.fieldDraft.set(null);
        // Re-project the World's Fields so the registry offers the new one, then reference it.
        this.fieldsLoader.reload();
        this.toggleRef(id, true);
      },
      error: () => this.error('worldFields.createError'),
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
