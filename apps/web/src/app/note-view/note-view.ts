import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { translateSignal, TranslocoPipe } from '@jsverse/transloco';
import { Editor, JSONContent } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import { TiptapEditorDirective } from 'ngx-tiptap';
import { EntitySession } from '../editor-shell/entity-session';
import { HeaderService } from '../shell/header.service';
import { Button } from '../ui/button';
import { Chip } from '../ui/chip';
import { EntityTags } from '../entity-tags/entity-tags';
import { CONTENT_EXTENSIONS } from './content-extensions';

/**
 * The view a `note` Entity opens into, parallel to {@link EditorShell} for a `hexmap`.
 * Mounts TipTap (ADR-0019): seeds from the stored snapshot, streams edits into the session's
 * live Content via `getJSON()` — never parses the snapshot, just carries it from load to save.
 */
@Component({
  selector: 'app-note-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    TranslocoPipe,
    TiptapEditorDirective,
    Button,
    Chip,
    EntityTags,
  ],
  host: { class: 'block min-h-full bg-surface-sunken' },
  template: `
    <div class="max-w-[60rem] mx-auto py-9 px-5">
      <div class="flex items-center gap-3">
        <a
          class="text-sm text-ink-muted no-underline hover:underline"
          routerLink="/entities"
          data-testid="back-to-library"
          >{{ 'noteView.backToLibrary' | transloco }}</a
        >
        <div class="flex items-center gap-2 ml-auto">
          @if (error()) {
            <app-chip tone="gold" data-testid="http-error">
              {{ 'noteView.httpError' | transloco }}
            </app-chip>
          }
          @if (conflict()) {
            <app-chip tone="gold" data-testid="conflict">
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
            appButton
            variant="primary"
            size="sm"
            data-testid="save"
            [disabled]="saving()"
            (click)="save()"
          >
            {{ (saving() ? 'editorShell.saving' : 'common.save') | transloco }}
          </button>
        </div>
      </div>

      <h1
        class="font-display text-3xl text-ink-strong mt-6"
        data-testid="note-title"
      >
        {{ name() }}
      </h1>

      <app-entity-tags class="mt-3 block" />

      <!--
        flex column + ProseMirror fills it (scoped CSS below) so a click anywhere in
        the box focuses the editor — without that, the empty area below prose swallows clicks.
      -->
      <div
        tiptap
        [editor]="editor"
        data-testid="note-content"
        class="mt-5 flex min-h-[24rem] flex-col rounded-md border border-line bg-surface px-5 py-1 text-ink cursor-text focus-within:border-gold"
      ></div>
    </div>
  `,
  styles: `
    /* TipTap creates .ProseMirror outside Angular's template — pierce with ::ng-deep.
       Suppress its focus ring: the wrapper's focus-within:border-gold already signals focus. */
    :host ::ng-deep .ProseMirror {
      flex: 1;
    }
    :host ::ng-deep .ProseMirror:focus-visible {
      outline: none;
      box-shadow: none;
    }
    :host ::ng-deep .ProseMirror p {
      margin: 0.4em 0;
    }
    :host ::ng-deep .ProseMirror h1 {
      font-size: 1.6em;
      font-weight: 600;
      margin: 0.7em 0 0.3em;
    }
    :host ::ng-deep .ProseMirror h2 {
      font-size: 1.35em;
      font-weight: 600;
      margin: 0.7em 0 0.3em;
    }
    :host ::ng-deep .ProseMirror h3 {
      font-size: 1.15em;
      font-weight: 600;
      margin: 0.7em 0 0.3em;
    }
    :host ::ng-deep .ProseMirror ul {
      list-style: disc;
      padding-left: 1.5em;
    }
    :host ::ng-deep .ProseMirror ol {
      list-style: decimal;
      padding-left: 1.5em;
    }
    :host ::ng-deep .ProseMirror blockquote {
      border-left: 3px solid var(--color-line);
      padding-left: 1em;
      color: var(--color-ink-muted);
    }
    :host ::ng-deep .ProseMirror a {
      color: var(--color-gold);
      text-decoration: underline;
    }
  `,
})
export class NoteView {
  private readonly session = inject(EntitySession);
  private readonly header = inject(HeaderService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly eyebrow = translateSignal('noteView.eyebrow');
  private readonly editorLabel = translateSignal('noteView.editorLabel');

  protected readonly name = computed(() => this.session.current()?.name ?? '');
  protected readonly saving = this.session.saving;
  protected readonly conflict = this.session.conflict;
  protected readonly error = this.session.error;

  /** Headless TipTap editor; the `tiptap` directive mounts it into the DOM. */
  protected readonly editor = new Editor({ extensions: CONTENT_EXTENSIONS });

  constructor() {
    // Tab title is owned by EntitySession (shared with the map editor), not here.
    this.header.set(
      computed(() => ({ eyebrow: this.eyebrow(), title: this.name() })),
      this.destroyRef,
    );

    // Label .ProseMirror (not the wrapper) — TipTap already sets role="textbox" on it.
    effect(() => {
      this.editor.view.dom.setAttribute('aria-label', this.editorLabel());
    });

    this.editor.on('update', ({ editor }) => {
      this.session.setContent(editor.getJSON());
    });

    // Seed on load/swap/conflict-reload (not on clean saves — in-flight keystrokes must survive).
    // Recreate editor state so Ctrl-Z can't undo past the seed point.
    effect(() => {
      const detail = this.session.seed();
      if (!detail || detail.document.type !== 'note') return;
      const snapshot = detail.document.content.snapshot;
      if (!isDocSnapshot(snapshot)) return;
      this.editor.commands.setContent(snapshot, { emitUpdate: false });
      const { state } = this.editor;
      this.editor.view.updateState(
        EditorState.create({ doc: state.doc, plugins: state.plugins }),
      );
    });

    this.destroyRef.onDestroy(() => this.editor.destroy());
  }

  protected save(): void {
    this.session.save().subscribe();
  }

  protected reload(): void {
    this.session.reload().subscribe();
  }
}

/** A malformed/placeholder snapshot (e.g. `{}`) leaves the editor on its empty doc rather than throwing. */
function isDocSnapshot(snapshot: unknown): snapshot is JSONContent {
  return (
    typeof snapshot === 'object' &&
    snapshot !== null &&
    (snapshot as { type?: unknown }).type === 'doc'
  );
}
