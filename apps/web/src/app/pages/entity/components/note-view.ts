import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { translateSignal, TranslocoPipe } from '@jsverse/transloco';
import { EntitySession } from '../services/entity-session';
import { Eyebrow } from '../../../ui/eyebrow';
import { PageHeader } from '../../../ui/page-header';
import { EntityTags } from './entity-tags';
import { ContentEditor } from './content-editor';
import { SaveStatus } from './save-status';

/**
 * The view a `note` Entity opens into, parallel to {@link EditorShell} for a `hexmap`:
 * page chrome (title, tags, autosave status) around the shared {@link ContentEditor}
 * (ADR-0019, ADR-0026).
 */
@Component({
  selector: 'app-note-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    TranslocoPipe,
    Eyebrow,
    PageHeader,
    EntityTags,
    ContentEditor,
    SaveStatus,
  ],
  host: { class: 'block min-h-full bg-surface-sunken' },
  template: `
    <app-page-header sticky>
      <a
        pageHeaderLeading
        class="text-sm text-ink-muted no-underline hover:underline"
        routerLink="/entities"
        data-testid="back-to-library"
        >{{ 'noteView.backToLibrary' | transloco }}</a
      >
      <div pageHeaderTitle class="flex flex-col min-w-0">
        <span appEyebrow class="text-gold! tracking-[0.28em]">{{
          'noteView.eyebrow' | transloco
        }}</span>
        <h1
          class="font-display text-[22px] text-ink-strong m-0 leading-tight truncate"
          data-testid="note-title"
        >
          {{ name() }}
        </h1>
      </div>
      <app-save-status pageHeaderActions />
    </app-page-header>

    <main class="max-w-[60rem] mx-auto py-5 px-5">
      <app-entity-tags class="block" />
      <app-content-editor class="mt-5" [ariaLabel]="editorLabel()" />
    </main>
  `,
})
export class NoteView {
  private readonly session = inject(EntitySession);
  protected readonly editorLabel = translateSignal('noteView.editorLabel');

  protected readonly name = computed(() => this.session.current()?.name ?? '');
}
