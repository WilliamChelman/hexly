import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Metadata } from '@hexly/domain';
import { Button, Dialog } from '@hexly/web-ui';
import { EntitySession } from '../services/entity-session';
import { EntityTypesEditor } from './entity-types-editor';

/**
 * The open Entity's Edit-types dialog (#189), opened from the actions menu: binds
 * {@link EntityTypesEditor} to the {@link EntitySession} — a type-set edit lands on `setTypes`, the
 * add-type prompt's Field values on `mutate` — so both ride the version-checked autosave.
 */
@Component({
  selector: 'app-entity-types-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  imports: [Button, Dialog, EntityTypesEditor, TranslocoPipe],
  template: `
    @if (open()) {
      <app-dialog [open]="true" [heading]="'entityTypes.heading' | transloco" (closed)="closed.emit()">
        <p class="m-0 mb-4 text-sm text-ink-muted">{{ 'entityTypes.hint' | transloco }}</p>
        <app-entity-types-editor
          [types]="session.types()"
          [metadata]="metadata()"
          [writable]="session.writable()"
          (typesChange)="session.setTypes($event)"
          (metadataChange)="onMetadata($event)"
        />
        <button dialogFooter type="button" appButton data-testid="types-close" (click)="closed.emit()">
          {{ 'common.close' | transloco }}
        </button>
      </app-dialog>
    }
  `,
})
export class EntityTypesDialog {
  protected readonly session = inject(EntitySession);

  readonly open = input(false);
  readonly closed = output<void>();

  /** The live Metadata the editor validates required Fields against and the prompt seeds from. */
  protected readonly metadata = computed<Metadata>(() => this.session.body().metadata ?? {});

  /** Fold the add-type prompt's collected Field values into the one Metadata map through the store. */
  protected onMetadata(metadata: Metadata): void {
    this.session.mutate((draft) => {
      draft.metadata = metadata;
    });
  }
}
