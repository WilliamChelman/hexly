import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { translateSignal, TranslocoPipe } from '@jsverse/transloco';
import { Editor, JSONContent } from '@tiptap/core';
import { TiptapDirective } from './tiptap.directive';
import { EntitySession } from '../services/entity-session';
import { Button } from '../../../ui/button';
import { Chip } from '../../../ui/chip';
import { Eyebrow } from '../../../ui/eyebrow';
import { PageHeader } from '../../../ui/page-header';
import { EntityTags } from './entity-tags';
import { CONTENT_EXTENSIONS } from './content-extensions';
import { SlashMenu } from './slash-menu';
import { slashCommands } from './slash-commands';
import { FormattingMenu } from './formatting-menu';
import { BubbleMenuDirective } from './bubble-menu.directive';

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
    Button,
    Chip,
    Eyebrow,
    PageHeader,
    EntityTags,
    SlashMenu,
    FormattingMenu,
    BubbleMenuDirective,
    TiptapDirective,
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

      <!--
        flex column + ProseMirror fills it (scoped CSS below) so a click anywhere in
        the box focuses the editor — without that, the empty area below prose swallows clicks.
      -->
      <div
        [appTiptap]="editor()"
        data-testid="note-content"
        class="mt-5 flex min-h-[24rem] flex-col rounded-md border border-line bg-surface px-5 py-3 text-ink cursor-text focus-within:border-gold"
      ></div>
    </main>

    <app-slash-menu />

    <!-- Out of flow + hidden until the bubble-menu plugin positions it over a
         text selection (it sets position/left/top and flips visibility on show). -->
    <app-formatting-menu
      appBubbleMenu
      [editor]="editor()"
    />
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
export class NoteView {
  private readonly session = inject(EntitySession);
  private readonly destroyRef = inject(DestroyRef);
  private readonly editorLabel = translateSignal('noteView.editorLabel');

  protected readonly name = computed(() => this.session.current()?.name ?? '');
  protected readonly saving = this.session.saving;
  protected readonly conflict = this.session.conflict;
  protected readonly error = this.session.error;

  private readonly slashMenu = viewChild(SlashMenu);

  // Recreated on every seed (load/swap/conflict-reload) rather than surgically reset:
  // a fresh Editor has empty undo history for free, so Ctrl-Z can't reach past the seed,
  // and TiptapDirective / BubbleMenuDirective re-bind to the new instance through their
  // signal inputs — no manual plugin re-registration. Starts empty; the first seed swaps
  // in the stored snapshot.
  protected readonly editor = signal(this.createEditor());

  constructor() {
    // Tab title is owned by EntitySession (shared with the map editor), not here.

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
      this.editor().view.dom.setAttribute('aria-label', this.editorLabel());
    });

    // Seed on load/swap/conflict-reload (not on clean saves — in-flight keystrokes must survive).
    effect(() => {
      const detail = this.session.seed();
      if (!detail || detail.document.type !== 'note') return;
      const snapshot = detail.document.content.snapshot;
      if (!isDocSnapshot(snapshot)) return;
      // untracked: this effect reacts to seed(), not to its own editor swap.
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
