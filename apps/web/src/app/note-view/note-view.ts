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
import { EditorSession } from '../editor-shell/editor-session';
import { HeaderService } from '../shell/header.service';
import { Button } from '../ui/button';
import { Chip } from '../ui/chip';
import { CONTENT_EXTENSIONS } from './content-extensions';

/**
 * The view a `note` Entity opens into (#70, #71), parallel to {@link EditorShell} for
 * a `hexmap`. Mounts the TipTap rich-text editor (ADR-0019) on the open note: it
 * seeds from the note's stored Content snapshot, streams every edit into the session's
 * live Content, and saves the whole document under the note's base version.
 *
 * The editor sits behind the **opaque-snapshot boundary**: this view hands the session
 * the editor's `getJSON()` snapshot verbatim ({@link EditorSession.setContent}); neither
 * this view nor the session parses it. The registered extension set ({@link
 * CONTENT_EXTENSIONS}) is the schema half of the `tiptap-v1` format contract.
 */
@Component({
  selector: 'app-note-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslocoPipe, TiptapEditorDirective, Button, Chip],
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

      <!--
        The editable surface. ngx-tiptap's directive mounts the (headless) editor
        here; we read its JSON out through editor.on('update'), not the DOM, so the
        snapshot stays opaque. Slash menu / formatting toolbar are later slices.

        The wrapper is a flex column and the mounted ProseMirror editable fills
        it (scoped CSS below), so a click anywhere in the box — not just on a text
        line — lands in the editor and drops the caret near it. Without that, the
        empty area below the prose is dead space that swallows clicks.
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
    /* The ProseMirror editable is created by TipTap outside this template, so it
       carries no encapsulation attribute — pierce to it with :host ::ng-deep,
       scoped to this component's subtree. It fills the wrapper so the whole box is
       clickable, and we restore the prose semantics Tailwind's preflight strips
       (list markers, heading sizes) so structure is legible before the formatting
       toolbar slice ships. */
    /* The wrapper already signals focus with focus-within:border-gold, so suppress
       the editable's own ring — the global :focus-visible box-shadow (base.css) —
       so focus reads as one box, not two nested ones. */
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
  private readonly session = inject(EditorSession);
  private readonly header = inject(HeaderService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly eyebrow = translateSignal('noteView.eyebrow');
  private readonly editorLabel = translateSignal('noteView.editorLabel');

  /** The open note's name, or empty before one is loaded. */
  protected readonly name = computed(() => this.session.current()?.name ?? '');
  /** Whether a save is in flight — disables the Save button. */
  protected readonly saving = this.session.saving;
  /** The server's current note when a save was rejected as stale, else `null`. */
  protected readonly conflict = this.session.conflict;
  /** Non-null when the last save or reload HTTP request failed. */
  protected readonly error = this.session.error;

  /** The headless TipTap editor; the template's `tiptap` directive mounts it. */
  protected readonly editor = new Editor({ extensions: CONTENT_EXTENSIONS });

  constructor() {
    // Tab title is owned by EditorSession (shared with the map editor), not here.
    this.header.set(
      computed(() => ({ eyebrow: this.eyebrow(), title: this.name() })),
      this.destroyRef,
    );

    // Label the actual contenteditable (the .ProseMirror TipTap creates) rather than
    // the wrapper — TipTap already sets role="textbox" on it, so we only add the label.
    effect(() => {
      this.editor.view.dom.setAttribute('aria-label', this.editorLabel());
    });

    // Stream every edit into the session's live, opaque Content (the save source).
    this.editor.on('update', ({ editor }) => {
      this.session.setContent(editor.getJSON());
    });

    // Seed from the server's authoritative snapshot on initial load, conflict reload,
    // and note swap. `session.seed()` does NOT change on clean saves or renames, so
    // in-flight keystrokes are never discarded. Clears undo history so the user can't
    // Ctrl-Z past a conflict reload back to the rejected draft.
    effect(() => {
      const detail = this.session.seed();
      if (!detail || detail.document.type !== 'note') return;
      const snapshot = detail.document.content.snapshot;
      if (!isDocSnapshot(snapshot)) return;
      this.editor.commands.setContent(snapshot, { emitUpdate: false });
      // Recreate state with the seeded doc so Ctrl-Z can't reach back past this point.
      const { state } = this.editor;
      this.editor.view.updateState(
        EditorState.create({ doc: state.doc, plugins: state.plugins }),
      );
    });

    this.destroyRef.onDestroy(() => this.editor.destroy());
  }

  /** Persist the note. A stale-version rejection surfaces as the conflict chip. */
  protected save(): void {
    this.session.save().subscribe();
  }

  /** Resolve a surfaced conflict by re-pulling the server's current note. */
  protected reload(): void {
    this.session.reload().subscribe();
  }
}

/**
 * Whether an opaque snapshot is a mountable ProseMirror document. Guards the seed so a
 * malformed or placeholder snapshot (e.g. `{}`) leaves the editor on its empty doc
 * rather than throwing in `setContent`.
 */
function isDocSnapshot(snapshot: unknown): snapshot is JSONContent {
  return (
    typeof snapshot === 'object' &&
    snapshot !== null &&
    (snapshot as { type?: unknown }).type === 'doc'
  );
}
