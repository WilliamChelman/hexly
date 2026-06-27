import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Editor, JSONContent } from '@tiptap/core';
import { TiptapDirective } from './tiptap.directive';
import { EntitySession } from '../services/entity-session';
import { CONTENT_EXTENSIONS } from './content-extensions';
import { SlashMenu } from './slash-menu';
import { slashCommands } from './slash-commands';
import { FormattingMenu } from './formatting-menu';
import { BubbleMenuDirective } from './bubble-menu.directive';

/**
 * The Content editing surface every Entity shares (ADR-0019): mounts TipTap,
 * seeds from the open Entity's stored snapshot, and streams edits back into the
 * session's live Content via `getJSON()` — never parsing the snapshot, just
 * carrying it from load to save. {@link NoteView} wraps it in a note's page
 * chrome; the hex map editor mounts it as the Note view of a `hexmap`. The host
 * is the framed editor box; callers add only outer placement (margin/width).
 */
@Component({
  selector: 'app-content-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SlashMenu, FormattingMenu, BubbleMenuDirective, TiptapDirective],
  host: {
    class:
      'flex min-h-[24rem] flex-col rounded-md border border-line bg-surface px-5 py-3 text-ink cursor-text focus-within:border-gold',
  },
  template: `
    <!--
      flex column + ProseMirror fills it (scoped CSS below) so a click anywhere in
      the box focuses the editor — without that, the empty area below prose swallows clicks.
    -->
    <div [appTiptap]="editor()" data-testid="note-content" class="flex flex-1 flex-col"></div>

    <app-slash-menu />

    <!-- Out of flow + hidden until the bubble-menu plugin positions it over a
         text selection (it sets position/left/top and flips visibility on show). -->
    <app-formatting-menu appBubbleMenu [editor]="editor()" />
  `,
  styles: `
    /* TipTap creates .ProseMirror outside Angular's template — pierce with ::ng-deep.
       Suppress its focus ring: the host's focus-within:border-gold already signals focus. */
    :host ::ng-deep .ProseMirror {
      flex: 1;
    }
    :host ::ng-deep .ProseMirror:focus-visible {
      outline: none;
      box-shadow: none;
    }
    /* Collapse leading/trailing block margins so prose doesn't hug the border. */
    :host ::ng-deep .ProseMirror > :first-child {
      margin-top: 0;
    }
    :host ::ng-deep .ProseMirror > :last-child {
      margin-bottom: 0;
    }
    :host ::ng-deep .ProseMirror p {
      margin: 0.6em 0;
    }
    :host ::ng-deep .ProseMirror h1 {
      font-size: 1.8em;
      font-weight: 600;
      margin: 0.9em 0 0.3em;
    }
    :host ::ng-deep .ProseMirror h2 {
      font-size: 1.4em;
      font-weight: 600;
      margin: 0.9em 0 0.3em;
    }
    :host ::ng-deep .ProseMirror h3 {
      font-size: 1.15em;
      font-weight: 600;
      margin: 0.8em 0 0.3em;
    }
    :host ::ng-deep .ProseMirror h4 {
      font-size: 1em;
      font-weight: 600;
      margin: 0.8em 0 0.3em;
    }
    :host ::ng-deep .ProseMirror h5 {
      font-size: 0.9em;
      font-weight: 600;
      margin: 0.75em 0 0.25em;
    }
    :host ::ng-deep .ProseMirror h6 {
      font-size: 0.85em;
      font-weight: 600;
      margin: 0.75em 0 0.25em;
      color: var(--color-ink-muted);
    }
    :host ::ng-deep .ProseMirror ul,
    :host ::ng-deep .ProseMirror ol {
      margin: 0.6em 0;
      padding-left: 1.5em;
    }
    :host ::ng-deep .ProseMirror ul {
      list-style: disc;
    }
    :host ::ng-deep .ProseMirror ol {
      list-style: decimal;
    }
    /* List rows read as a tight list, not stacked paragraphs. */
    :host ::ng-deep .ProseMirror li {
      margin: 0.15em 0;
    }
    :host ::ng-deep .ProseMirror li p {
      margin: 0;
    }
    :host ::ng-deep .ProseMirror li::marker {
      color: var(--color-ink-muted);
    }
    :host ::ng-deep .ProseMirror blockquote {
      border-left: 3px solid var(--color-line-strong);
      padding-left: 1em;
      margin: 0.8em 0;
      font-style: italic;
      color: var(--color-ink-muted);
    }
    :host ::ng-deep .ProseMirror hr {
      border: none;
      border-top: 1px solid var(--color-line);
      margin: 1.4em 0;
    }
    /* Code block: a sunken well; inline code: a subtle inline chip. */
    :host ::ng-deep .ProseMirror pre {
      margin: 0.8em 0;
      padding: 0.85em 1em;
      border: 1px solid var(--color-line);
      border-radius: var(--radius-md);
      background: var(--color-surface-sunken);
      overflow-x: auto;
      font-family: var(--font-mono);
      font-size: 0.85em;
      line-height: var(--leading-normal);
    }
    :host ::ng-deep .ProseMirror pre code {
      padding: 0;
      background: none;
      font-size: inherit;
    }
    :host ::ng-deep .ProseMirror :not(pre) > code {
      padding: 0.1em 0.35em;
      border: 1px solid var(--color-line);
      border-radius: var(--radius-sm);
      background: var(--color-surface-sunken);
      font-family: var(--font-mono);
      font-size: 0.85em;
    }
    :host ::ng-deep .ProseMirror a {
      color: var(--color-gold);
      text-decoration: underline;
    }
  `,
})
export class ContentEditor {
  private readonly session = inject(EntitySession);
  private readonly destroyRef = inject(DestroyRef);

  /** The editor's accessible name, localized by the caller (ADR-0014). */
  readonly ariaLabel = input.required<string>();

  private readonly slashMenu = viewChild(SlashMenu);

  // Recreated on every seed (load/swap/conflict-reload) rather than surgically reset:
  // a fresh Editor has empty undo history for free, so Ctrl-Z can't reach past the seed,
  // and TiptapDirective / BubbleMenuDirective re-bind to the new instance through their
  // signal inputs — no manual plugin re-registration. Starts empty; the first seed swaps
  // in the stored snapshot.
  protected readonly editor = signal(this.createEditor());

  constructor() {
    // Stream edits to the session; re-attach when the editor instance swaps (the old
    // one's listener dies with it on destroy()).
    effect((onCleanup) => {
      const editor = this.editor();
      const push = ({ editor }: { editor: Editor }) =>
        this.session.setContent(editor.getJSON());
      editor.on('update', push);
      onCleanup(() => editor.off('update', push));
    });

    // Label .ProseMirror (not the wrapper) — TipTap already sets role="textbox" on it.
    // Re-runs on language change and on editor swap.
    effect(() => {
      this.editor().view.dom.setAttribute('aria-label', this.ariaLabel());
    });

    // Seed on load/swap/conflict-reload (not on clean saves — in-flight keystrokes must
    // survive), keyed off seed() so a keystroke never recreates the editor. The snapshot
    // is read from the session's *live* Content, not the seed detail: a clean save advances
    // the live Content but not the seed, so a mid-session remount (the hexmap Map↔Note
    // toggle, #75) restores the latest prose rather than the originally-loaded one.
    effect(() => {
      const detail = this.session.seed();
      if (!detail) return;
      // untracked: this effect reacts to seed() and its own editor swap, never to the
      // live Content (which every keystroke updates — tracking it would thrash the editor).
      const snapshot = untracked(this.session.content)?.snapshot;
      if (!isDocSnapshot(snapshot)) return;
      const previous = untracked(this.editor);
      this.editor.set(this.createEditor(snapshot));
      previous.destroy();
    });

    this.destroyRef.onDestroy(() => this.editor().destroy());
  }

  // slashCommands is UI chrome, not part of the persisted schema, so it lives here
  // rather than in CONTENT_EXTENSIONS (ADR-0019). The menu getter is deferred: render
  // only fires on a real "/" keystroke, long after the viewChild has resolved.
  private createEditor(content?: JSONContent): Editor {
    return new Editor({
      extensions: [...CONTENT_EXTENSIONS, slashCommands(() => this.slashMenu())],
      content,
    });
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
