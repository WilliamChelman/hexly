import {
  ChangeDetectionStrategy,
  Component,
} from '@angular/core';
import { translateSignal } from '@jsverse/transloco';
import { EntityHeader } from './entity-header';
import { ContentEditor } from './content-editor';

/**
 * The view a `note` Entity opens into, parallel to {@link EditorShell} for a `hexmap`:
 * the shared {@link EntityHeader} above the shared {@link ContentEditor} in a centered
 * reading column (ADR-0019, ADR-0026). A note has no grid, so the header omits the
 * Map/Note view toggle.
 */
@Component({
  selector: 'app-note-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EntityHeader, ContentEditor],
  host: { class: 'block h-full' },
  template: `
    <div class="grid grid-rows-[auto_1fr] h-full">
      <app-entity-header />
      <main class="overflow-y-auto bg-surface-sunken">
        <div class="max-w-[60rem] mx-auto py-5 px-5">
          <app-content-editor [ariaLabel]="editorLabel()" />
        </div>
      </main>
    </div>
  `,
})
export class NoteView {
  protected readonly editorLabel = translateSignal('noteView.editorLabel');
}
