import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { EditorSession } from '../editor-shell/editor-session';
import { EditorHeader } from '../editor-shell/editor-header';

/**
 * The header-outlet half of the `/entities/:id` dispatch (#70, ADR-0015): it
 * projects the interactive {@link EditorHeader} for a `hexmap` and nothing for a
 * `note` — a note's chrome is the plain name it contributes through
 * {@link HeaderService} from {@link NoteView}, not a map-scoped header. Reads the
 * open Entity from the shared {@link EditorSession}; {@link EntityShell} owns the
 * load.
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
  private readonly session = inject(EditorSession);

  protected readonly isHexmap = computed(
    () => this.session.current()?.document.type === 'hexmap',
  );
}
