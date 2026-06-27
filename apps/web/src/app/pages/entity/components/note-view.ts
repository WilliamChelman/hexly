import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { translateSignal, TranslocoPipe } from '@jsverse/transloco';
import { EntitySession } from '../services/entity-session';
import { Button } from '../../../ui/button';
import { Chip } from '../../../ui/chip';
import { Eyebrow } from '../../../ui/eyebrow';
import { PageHeader } from '../../../ui/page-header';
import { EntityTags } from './entity-tags';
import { ContentEditor } from './content-editor';

/**
 * The view a `note` Entity opens into, parallel to {@link EditorShell} for a `hexmap`.
 * The Content body itself is the shared {@link ContentEditor} (ADR-0019); this view owns
 * only the note's page chrome — title, tags, Save/conflict — around it.
 */
@Component({
  selector: 'app-note-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    TranslocoPipe,
    Button,
    Chip,
    Eyebrow,
    PageHeader,
    EntityTags,
    ContentEditor,
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
      @if (error()) {
        <app-chip pageHeaderActions tone="gold" data-testid="http-error">
          {{ 'noteView.httpError' | transloco }}
        </app-chip>
      }
      @if (conflict()) {
        <app-chip pageHeaderActions tone="gold" data-testid="conflict">
          {{ 'editorShell.save.conflict' | transloco }}
          <button
            type="button"
            appButton
            variant="ghost"
            size="sm"
            class="ml-2 underline"
            data-testid="conflict-reload"
            (click)="reload()"
          >
            {{ 'editorShell.reload' | transloco }}
          </button>
        </app-chip>
      }
      <button
        type="button"
        pageHeaderActions
        appButton
        variant="primary"
        size="sm"
        data-testid="save"
        [disabled]="saving()"
        (click)="save()"
      >
        {{ (saving() ? 'editorShell.saving' : 'common.save') | transloco }}
      </button>
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
  protected readonly saving = this.session.saving;
  protected readonly conflict = this.session.conflict;
  protected readonly error = this.session.error;

  protected save(): void {
    this.session.save().subscribe();
  }

  protected reload(): void {
    this.session.reload().subscribe();
  }
}
