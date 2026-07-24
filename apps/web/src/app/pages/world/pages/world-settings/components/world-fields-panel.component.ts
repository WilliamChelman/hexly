import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Field } from '@hexly/domain';
import { ToasterService, WorldsClient } from '@hexly/web-core';
import { ButtonComponent, DialogComponent } from '@hexly/web-ui';
import { WorldFieldsLoader } from '../../../../../entity-types/world-fields-loader';
import { ViewRegistry } from '../../../../../entity-types/view-registry';
import { dataTypeLabel } from '../utils/field-data-type';
import { WorldFieldFormComponent } from './world-field-form.component';

/**
 * The World-Owner surface for authoring reusable **Fields** (ADR-0054, #230), sibling to the World
 * Types editor: it lists a World's custom Fields and hosts the {@link WorldFieldFormComponent} in a dialog to
 * create/edit one. The form persists; this panel owns the list and re-projects on success via
 * {@link WorldFieldsLoader} so attach pickers and entity editors see the change at once. Deletes are
 * Owner-gated server-side; a refusal toasts and leaves the list untouched.
 */
@Component({
  selector: 'app-world-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, ButtonComponent, DialogComponent, WorldFieldFormComponent],
  template: `
    <ul class="field-list">
      @for (f of rows(); track f.id) {
        <li class="field-row" [attr.data-testid]="'field-' + f.id">
          <div class="field-meta">
            <span class="field-name">{{ f.label }}</span>
            <span class="field-id">{{ f.id }}</span>
          </div>
          <span class="field-type" [attr.data-testid]="'field-type-' + f.id">{{ f.typeLabel }}</span>
          <button appButton size="sm" [attr.data-testid]="'edit-' + f.id" (click)="editing.set(f.field)">
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

    <button appButton variant="primary" class="field-new" data-testid="field-new" (click)="editing.set(null)">
      {{ 'worldFields.add' | transloco }}
    </button>

    <app-dialog [open]="editing() !== undefined" [heading]="dialogTitle() | transloco" align="top" (closed)="close()">
      @if (editing() !== undefined) {
        <app-world-field-form [worldId]="id()" [field]="editing() || null" (saved)="onSaved()" (cancelled)="close()" />
      }
    </app-dialog>
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
    .field-new {
      @apply mt-4;
    }
  `,
})
export class WorldFieldsPanelComponent implements OnInit {
  readonly id = input.required<string>();

  private readonly worlds = inject(WorldsClient);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);
  private readonly loader = inject(WorldFieldsLoader);
  private readonly views = inject(ViewRegistry);

  protected readonly fields = signal<readonly Field[]>([]);
  /** The editor target: `undefined` closed, `null` creating, a Field editing. Drives the dialog. */
  protected readonly editing = signal<Field | null | undefined>(undefined);

  private readonly structuredKinds = computed(() => this.views.offerableDataTypes());

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

  /** The editor dialog's title — creating vs editing. */
  protected readonly dialogTitle = computed(() =>
    this.editing() ? 'worldFields.editTitle' : 'worldFields.createTitle',
  );

  ngOnInit(): void {
    this.load();
  }

  protected close(): void {
    this.editing.set(undefined);
  }

  /** The form persisted a create/update: close the dialog, reload the list, and re-project the registry. */
  protected onSaved(): void {
    this.close();
    this.load();
    this.loader.reload();
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

  /** A Data Type's display name, shared with the World Types editor — built-ins under the `worldFields` catalog. */
  private dataTypeLabel(kind: string, structured: ReadonlyMap<string, string>): string {
    return dataTypeLabel(kind, structured, (key) => this.transloco.translate(key), 'worldFields.dataType');
  }

  private error(key: string): void {
    this.toaster.show(this.transloco.translate(key), 'error');
  }
}
