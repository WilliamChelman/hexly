import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { translateSignal, TranslocoPipe } from '@jsverse/transloco';
import { EditorSession } from '../editor-shell/editor-session';
import { HeaderService } from '../shell/header.service';

/**
 * The minimal note view (#70): the named shell a `note` Entity opens into,
 * parallel to {@link EditorShell} for a `hexmap`. It reads the open Entity from
 * the shared {@link EditorSession} — {@link EntityShell} has already loaded it —
 * and shows its name; the rich-text Content editor (TipTap, ADR-0019) lands in a
 * later slice, so for now this is a named placeholder, not an editor.
 */
@Component({
  selector: 'app-note-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslocoPipe],
  host: { class: 'block min-h-full bg-surface-sunken' },
  template: `
    <div class="max-w-[60rem] mx-auto py-9 px-5 text-center">
      <a
        class="text-sm text-ink-muted no-underline hover:underline"
        routerLink="/entities"
        data-testid="back-to-library"
        >{{ 'noteView.backToLibrary' | transloco }}</a
      >
      <h1 class="font-display text-2xl text-ink-strong mt-6" data-testid="note-title">
        {{ name() }}
      </h1>
      <p class="mt-3 text-ink-muted">{{ 'noteView.placeholder' | transloco }}</p>
    </div>
  `,
})
export class NoteView {
  private readonly session = inject(EditorSession);
  private readonly header = inject(HeaderService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly eyebrow = translateSignal('noteView.eyebrow');

  /** The open note's name, or empty before one is loaded. */
  protected readonly name = computed(() => this.session.current()?.name ?? '');

  constructor() {
    // Contribute this note's name to the single app header (ADR-0015) as a
    // computed, so the chrome tracks renames and a live language switch. The tab
    // title is owned by EditorSession, shared with the map editor.
    this.header.set(
      computed(() => ({ eyebrow: this.eyebrow(), title: this.name() })),
      this.destroyRef,
    );
  }
}
