import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  EnvironmentInjector,
  Injector,
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
import { EntityNameResolver } from '../services/entity-name-resolver';
import { CONTENT_EXTENSIONS } from './content-extensions';
import { entityLinkNode } from './entity-link-node';
import { SlashMenu } from './slash-menu';
import { slashCommands } from './slash-commands';
import { EntityPicker } from './entity-picker';
import { entityMention } from './entity-mention';
import { createEntityLinkNodeView } from './entity-link-view';
import { FormattingMenu } from './formatting-menu';
import { BubbleMenuDirective } from './bubble-menu.directive';

/**
 * The Content editing surface every Entity shares (ADR-0019): mounts TipTap,
 * seeds from the Entity's stored snapshot, streams edits back to the session's
 * live Content via `getJSON()` — carrying the snapshot load-to-save, never
 * parsing it. {@link NoteView} wraps it in note chrome; the hex map editor
 * mounts it as a `hexmap`'s Note view. Host is the framed box; callers add only
 * outer placement.
 */
@Component({
  selector: 'app-content-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SlashMenu,
    EntityPicker,
    FormattingMenu,
    BubbleMenuDirective,
    TiptapDirective,
  ],
  host: {
    class:
      'flex min-h-[24rem] flex-col rounded-md border border-line bg-surface px-5 py-3 text-ink cursor-text focus-within:border-gold',
  },
  template: `
    <!-- ProseMirror fills the flex column (scoped CSS below) so a click anywhere
         in the box focuses the editor, not just on the prose. -->
    @if (editor()) {
      <div [appTiptap]="editor()!" data-testid="note-content" class="flex flex-1 flex-col"></div>

      <!-- Hidden until the bubble-menu plugin positions it over a text selection. -->
      <app-formatting-menu appBubbleMenu [editor]="editor()!" />
    }

    <app-slash-menu />
    <app-entity-picker />
  `,
  styles: `
    /* .ProseMirror lives outside Angular's template — pierce with ::ng-deep.
       Suppress its focus ring; host's focus-within:border-gold already signals focus. */
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
  // The shared id→name resolver backs both the `@` picker (its entity list) and
  // every entityLink node view; provided at the entities/:id route so navigating
  // gets a fresh owner list. The route-level EnvironmentInjector is what each node
  // view is created in, so they resolve the very same instance (ADR-0023).
  private readonly resolver = inject(EntityNameResolver);
  private readonly environmentInjector = inject(EnvironmentInjector);
  // ContentEditor's own node injector — lives inside the router outlet, so the
  // entityLink node views created from it can resolve ActivatedRoute for routerLink.
  private readonly injector = inject(Injector);
  private readonly appRef = inject(ApplicationRef);

  /** The editor's accessible name, localized by the caller (ADR-0014). */
  readonly ariaLabel = input.required<string>();

  private readonly slashMenu = viewChild(SlashMenu);
  private readonly entityPicker = viewChild(EntityPicker);

  // Recreated on every seed rather than reset: a fresh Editor gets empty undo
  // history for free (Ctrl-Z can't reach past the seed), and the directives re-bind
  // via their signal inputs. Null until the first seed, so mount doesn't double-construct.
  protected readonly editor = signal<Editor | null>(null);

  constructor() {
    // Stream edits to the session; re-attach on editor swap.
    effect((onCleanup) => {
      const editor = this.editor();
      if (!editor) return;
      const push = ({ editor }: { editor: Editor }) =>
        this.session.setContent(editor.getJSON());
      editor.on('update', push);
      onCleanup(() => editor.off('update', push));
    });

    // Label .ProseMirror (not the wrapper) — TipTap sets role="textbox" on it.
    effect(() => {
      const editor = this.editor();
      if (!editor) return;
      editor.view.dom.setAttribute('aria-label', this.ariaLabel());
    });

    // Seed on load/swap/conflict-reload, keyed off seed() so a keystroke never
    // recreates the editor. Snapshot comes from the *live* Content, not the seed
    // detail: a clean save advances live Content but not seed, so a mid-session
    // remount (hexmap Map↔Note toggle, #75) restores the latest prose, not the loaded one.
    effect(() => {
      const detail = this.session.seed();
      if (!detail) return;
      // untracked: react to seed() and own editor swap, never to live Content —
      // every keystroke updates it and tracking it would thrash the editor.
      const content = untracked(this.session.content);
      if (content === null) return; // mid-load
      // Empty placeholder snapshot ({}) yields an empty editor — correct after a
      // conflict reload where the server has no stored prose.
      const snapshot = isDocSnapshot(content.snapshot) ? content.snapshot : undefined;
      const previous = untracked(this.editor);
      this.editor.set(this.createEditor(snapshot));
      // Destroy after TiptapDirective mounts the new surface (next render) so there's
      // no blank frame between old DOM out and new DOM in.
      queueMicrotask(() => previous?.destroy());
    });

    this.destroyRef.onDestroy(() => this.editor()?.destroy());
  }

  // slashCommands and entityMention are UI chrome, not persisted schema, so they
  // live here rather than CONTENT_EXTENSIONS (ADR-0019). The menu/picker getters are
  // deferred: render only fires on a "/" or "@" keystroke, long after the viewChild
  // resolves. The entityLink node *schema* is in CONTENT_EXTENSIONS (framework-free);
  // its Angular node view attaches here by extending that node with addNodeView —
  // TipTap derives node views from the extension set, not editorProps, so we swap the
  // bare node for the view-carrying one rather than registering a raw PM nodeView.
  private createEditor(content?: JSONContent): Editor {
    const environmentInjector = this.environmentInjector;
    const elementInjector = this.injector;
    const appRef = this.appRef;
    const entityLinkWithView = entityLinkNode.extend({
      addNodeView() {
        return ({ node }) =>
          createEntityLinkNodeView(node, environmentInjector, elementInjector, appRef);
      },
    });
    return new Editor({
      extensions: [
        ...CONTENT_EXTENSIONS.filter(
          (e) => (e as { name?: string }).name !== entityLinkNode.name,
        ),
        entityLinkWithView,
        slashCommands(() => this.slashMenu()),
        entityMention(
          () => this.entityPicker(),
          () => this.resolver.loaded(),
        ),
      ],
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
