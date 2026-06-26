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
          @if (conflict()) {
            <app-chip tone="gold" data-testid="conflict">
              {{ 'noteView.conflict' | transloco }}
              <button
                type="button"
                class="ml-2 p-0 underline bg-transparent border-0 cursor-pointer"
                data-testid="conflict-reload"
                (click)="reload()"
              >
                {{ 'noteView.reload' | transloco }}
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
            {{ (saving() ? 'noteView.saving' : 'common.save') | transloco }}
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
        role="textbox"
        aria-multiline="true"
        [attr.aria-label]="'noteView.editorLabel' | transloco"
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

  /** The open note's name, or empty before one is loaded. */
  protected readonly name = computed(() => this.session.current()?.name ?? '');
  /** Whether a save is in flight — disables the Save button. */
  protected readonly saving = this.session.saving;
  /** The server's current note when a save was rejected as stale, else `null`. */
  protected readonly conflict = this.session.conflict;

  /** The headless TipTap editor; the template's `tiptap` directive mounts it. */
  protected readonly editor = new Editor({ extensions: CONTENT_EXTENSIONS });

  /**
   * The JSON signature the editor currently shows, so the seeding effect can tell an
   * incoming server snapshot apart from the echo of our own edit and never reset the
   * caret mid-typing. ponytail: stringify compare — note docs are small; revisit if a
   * note grows large enough that re-serialising per change shows up.
   */
  private shown: string | null = null;

  constructor() {
    // Tab title is owned by EditorSession (shared with the map editor), not here.
    this.header.set(
      computed(() => ({ eyebrow: this.eyebrow(), title: this.name() })),
      this.destroyRef,
    );

    // Stream every edit into the session's live, opaque Content (the save source).
    this.editor.on('update', ({ editor }) => {
      const json = editor.getJSON();
      this.shown = JSON.stringify(json);
      this.session.setContent(json);
    });

    // Seed (and re-seed on a conflict reload or a note swap) from the open note's
    // stored snapshot. Keyed on the open-Entity object, which changes on load / save /
    // rename but NOT on our own setContent — so typing never re-enters here. Skipped
    // when the snapshot already matches what's shown, so a clean save doesn't jump
    // the caret to the document start.
    effect(() => {
      const detail = this.session.current();
      if (!detail || detail.document.type !== 'note') return;
      const snapshot = detail.document.content.snapshot;
      if (!isDocSnapshot(snapshot)) return;
      const sig = JSON.stringify(snapshot);
      if (sig === this.shown) return;
      this.shown = sig;
      this.editor.commands.setContent(snapshot, { emitUpdate: false });
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
