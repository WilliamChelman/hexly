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
 * The view a `note` Entity opens into (#70), parallel to {@link EditorShell} for a
 * `hexmap`. Placeholder — TipTap content editor (ADR-0019) lands in a later slice.
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
    // Tab title is owned by EditorSession (shared with the map editor), not here.
    this.header.set(
      computed(() => ({ eyebrow: this.eyebrow(), title: this.name() })),
      this.destroyRef,
    );
  }
}
