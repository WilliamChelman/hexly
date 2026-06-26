import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { EntitySession } from '../../editor-shell/entity-session';
import { EditorHeader } from '../../editor-shell/editor-header';

/**
 * Header outlet for `/entities/:id` (ADR-0015): renders {@link EditorHeader} for a
 * `hexmap`, nothing for a `note` — a note contributes its name through
 * {@link HeaderService} from {@link NoteView} instead. {@link EntityPage} owns the load.
 */
@Component({
  selector: 'app-entity-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  imports: [EditorHeader],
  template: `
    @if (isHexmap()) {
      <app-editor-header />
    }
  `,
})
export class EntityHeader {
  private readonly session = inject(EntitySession);

  protected readonly isHexmap = computed(
    () => this.session.current()?.document.type === 'hexmap',
  );
}
