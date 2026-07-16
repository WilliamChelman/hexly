import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Button, Dialog } from '@hexly/web-ui';
import { EntitySession } from '../services/entity-session';
import { EntityFieldsEditor } from './entity-fields-editor';

/**
 * The open Entity's Edit-fields dialog (ADR-0054, #229): binds {@link EntityFieldsEditor} to the
 * {@link EntitySession} — an attach lands on `attachField` (minting the Field's default), a detach on
 * `detachField` (clearing its value), so both ride the version-checked autosave beside the type set.
 */
@Component({
  selector: 'app-entity-fields-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  imports: [Button, Dialog, EntityFieldsEditor, TranslocoPipe],
  template: `
    @if (open()) {
      <app-dialog [open]="true" [heading]="'entityFields.heading' | transloco" (closed)="closed.emit()">
        <p class="m-0 mb-4 text-sm text-ink-muted">{{ 'entityFields.hint' | transloco }}</p>
        <app-entity-fields-editor
          [types]="session.types()"
          [fields]="session.fields()"
          [writable]="session.writable()"
          (attach)="session.attachField($event)"
          (detach)="session.detachField($event)"
        />
        <button dialogFooter type="button" appButton data-testid="fields-close" (click)="closed.emit()">
          {{ 'common.close' | transloco }}
        </button>
      </app-dialog>
    }
  `,
})
export class EntityFieldsDialog {
  protected readonly session = inject(EntitySession);

  readonly open = input(false);
  readonly closed = output<void>();
}
