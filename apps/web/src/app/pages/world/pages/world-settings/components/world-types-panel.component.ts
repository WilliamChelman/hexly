import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { AvailableType } from '@hexly/domain';
import { ToasterService, WorldsClient } from '@hexly/web-core';
import { Button, Dialog } from '@hexly/web-ui';
import { WorldTypesLoader } from '../../../../../entity-types/world-types-loader';
import { WorldTypeForm } from './world-type-form.component';

/**
 * The World-Owner surface for authoring user-defined types (ADR-0048, ADR-0054): it lists a World's
 * types and hosts the {@link WorldTypeForm} in a dialog to create/edit one. The form persists; this
 * panel owns the list and re-projects on success via {@link WorldTypesLoader}. Deletes are Owner-gated
 * server-side; a refusal toasts and leaves the list untouched.
 */
@Component({
  selector: 'app-world-types',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, Button, Dialog, WorldTypeForm],
  template: `
    <ul class="type-list">
      @for (t of types(); track t.id) {
        <li class="type-row" [attr.data-testid]="'type-' + t.id">
          <div class="type-meta">
            <span class="type-name">{{ t.label }}</span>
            <span class="type-id">{{ t.id }}</span>
          </div>
          <span class="type-fieldcount">{{ t.fieldRefs.length }}</span>
          <button appButton size="sm" [attr.data-testid]="'edit-' + t.id" (click)="editing.set(t)">
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

    <button appButton variant="primary" class="type-new" data-testid="type-new" (click)="editing.set(null)">
      {{ 'worldTypes.add' | transloco }}
    </button>

    <app-dialog [open]="editing() !== undefined" [heading]="dialogTitle() | transloco" align="top" (closed)="close()">
      @if (editing() !== undefined) {
        <app-world-type-form [worldId]="id()" [type]="editing() || null" (saved)="onSaved()" (cancelled)="close()" />
      }
    </app-dialog>
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

  protected readonly types = signal<readonly AvailableType[]>([]);
  /** The editor target: `undefined` closed, `null` creating, a type editing. Drives the dialog. */
  protected readonly editing = signal<AvailableType | null | undefined>(undefined);

  /** The editor dialog's title — creating vs editing. */
  protected readonly dialogTitle = computed(() => (this.editing() ? 'worldTypes.editTitle' : 'worldTypes.createTitle'));

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
