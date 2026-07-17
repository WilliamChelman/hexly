import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  EnvironmentInjector,
  Injector,
  afterRenderEffect,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { Editor, JSONContent } from '@tiptap/core';
import { catchError, firstValueFrom, of } from 'rxjs';
import { Content, CONTENT_FIELD, tiptapContent } from '../lib';
import { EntitiesClient } from '@hexly/web-core';
import { ENTITY_SESSION, VIEW_FIELD_KEY } from '@hexly/web-entity';
import { TiptapDirective } from './tiptap.directive';
import { EntityNameResolver } from './entity-name-resolver';
import { CONTENT_EXTENSIONS } from './content-extensions';
import { entityLinkNode } from './entity-link-node';
import { calloutNode } from './callout-node';
import { createCalloutNodeView, focusCalloutTypeAtTop } from './callout-view';
import { SlashMenu } from './slash-menu';
import { slashCommands } from './slash-commands';
import { SLASH_ITEMS } from './slash-menu-items';
import { EntityPicker } from './entity-picker';
import { entityMention } from './entity-mention';
import { DescriptorPicker } from './descriptor-picker';
import { descriptorSuggestion } from './descriptor-suggestion';
import { LinkTextPicker } from './link-text-picker';
import { linkTextSuggestion } from './link-text-suggestion';
import { createEntityLinkNodeView } from './entity-link-view';
import { FormattingMenu } from './formatting-menu';
import { BubbleMenuDirective } from './bubble-menu.directive';

/** Debounce before folding the doc into the Entity Document: well under the autosave window, so a `mutate` (a
 * full-doc undo patch) fires ~per pause, not per key. A save flushes it regardless (ADR-0051). */
const COMMIT_DEBOUNCE_MS = 250;

/**
 * The Content editing surface every Entity shares (ADR-0019): mounts TipTap, which owns the live doc,
 * cursor, and history. Seeds from {@link ENTITY_SESSION}'s body when {@link EntitySession.loadGeneration}
 * ticks — not on an edit echo, so the cursor holds — and commits `getJSON()` back through `session.mutate`
 * on a debounce, discarding the patches (ADR-0051). Carries the snapshot load-to-save, never parsing it.
 */
@Component({
  selector: 'app-content-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SlashMenu,
    EntityPicker,
    DescriptorPicker,
    LinkTextPicker,
    FormattingMenu,
    BubbleMenuDirective,
    TiptapDirective,
  ],
  host: {
    class:
      'flex min-h-[24rem] flex-col rounded-md border border-line bg-surface px-6 py-3 text-ink cursor-text focus-within:border-gold',
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
    <app-descriptor-picker />
    <app-link-text-picker #displayPicker kind="display" />
    <app-link-text-picker #headingPicker kind="heading" />
  `,
  styles: `
    @reference '#app-styles.css';

    /* .ProseMirror lives outside Angular's template — pierce with ::ng-deep.
       Suppress its focus ring; host's focus-within:border-gold already signals focus. */
    :host ::ng-deep .ProseMirror {
      flex: 1;
    }
    :host ::ng-deep .ProseMirror:focus-visible {
      @apply outline-none shadow-none;
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
      @apply font-semibold;
      font-size: 1.8em;
      margin: 0.9em 0 0.3em;
    }
    :host ::ng-deep .ProseMirror h2 {
      @apply font-semibold;
      font-size: 1.4em;
      margin: 0.9em 0 0.3em;
    }
    :host ::ng-deep .ProseMirror h3 {
      @apply font-semibold;
      font-size: 1.15em;
      margin: 0.8em 0 0.3em;
    }
    :host ::ng-deep .ProseMirror h4 {
      @apply font-semibold;
      font-size: 1em;
      margin: 0.8em 0 0.3em;
    }
    :host ::ng-deep .ProseMirror h5 {
      @apply font-semibold;
      font-size: 0.9em;
      margin: 0.75em 0 0.25em;
    }
    :host ::ng-deep .ProseMirror h6 {
      @apply font-semibold text-ink-muted;
      font-size: 0.85em;
      margin: 0.75em 0 0.25em;
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
      @apply border-l-[3px] border-line-strong italic text-ink-muted;
      padding-left: 1em;
      margin: 0.8em 0;
    }
    :host ::ng-deep .ProseMirror hr {
      border: none;
      border-top: 1px solid var(--color-line);
      margin: 1.4em 0;
    }
    /* Code block: a sunken well; inline code: a subtle inline chip. */
    :host ::ng-deep .ProseMirror pre {
      @apply border border-line rounded-md bg-surface-sunken overflow-x-auto font-mono leading-normal;
      margin: 0.8em 0;
      padding: 0.85em 1em;
      font-size: 0.85em;
    }
    :host ::ng-deep .ProseMirror pre code {
      @apply p-0;
      background: none;
      font-size: inherit;
    }
    :host ::ng-deep .ProseMirror :not(pre) > code {
      @apply border border-line rounded-sm bg-surface-sunken font-mono;
      padding: 0.1em 0.35em;
      font-size: 0.85em;
    }
    :host ::ng-deep .ProseMirror a {
      @apply text-gold underline;
    }
    /* Callout (ADR-0033): a bordered box; the header carries its type + title, the
       body holds live block content (contentDOM). Colour-by-type is deferred. */
    :host ::ng-deep .ProseMirror .callout {
      @apply border border-line rounded-md bg-surface-sunken;
      margin: 0.8em 0;
      padding: 0.5em 0.85em;
    }
    :host ::ng-deep .ProseMirror .callout-header {
      @apply text-ink-muted;
      font-size: 0.8em;
      margin-bottom: 0.25em;
    }
    /* The type <select>: a bare inline control, not a chunky native dropdown. */
    :host ::ng-deep .ProseMirror .callout-type {
      @apply font-semibold uppercase cursor-pointer bg-transparent border-none text-ink-muted;
      letter-spacing: 0.04em;
      font-size: inherit;
      padding: 0;
      appearance: none;
    }
    :host ::ng-deep .ProseMirror .callout-type:hover {
      @apply text-ink;
    }
    :host ::ng-deep .ProseMirror .callout-title {
      @apply font-semibold text-ink;
      margin-left: 0.5em;
    }
    /* Table: bordered cells so a table reads as a grid, not stacked text. */
    :host ::ng-deep .ProseMirror table {
      @apply border-collapse;
      margin: 0.8em 0;
      width: 100%;
    }
    :host ::ng-deep .ProseMirror :is(th, td) {
      @apply border border-line;
      padding: 0.35em 0.6em;
      text-align: left;
    }
    :host ::ng-deep .ProseMirror th {
      @apply bg-surface-sunken font-semibold;
    }
    /* Task list: hang the checkbox beside its item, drop the list marker. */
    :host ::ng-deep .ProseMirror ul[data-type='taskList'] {
      list-style: none;
      padding-left: 0.25em;
    }
    :host ::ng-deep .ProseMirror ul[data-type='taskList'] li {
      @apply flex items-start gap-2;
    }
    :host ::ng-deep .ProseMirror img {
      @apply rounded-md;
      max-width: 100%;
      height: auto;
    }
    /* Highlight mark (==text==): a warm wash that reads on the app's surface. */
    :host ::ng-deep .ProseMirror mark {
      background: color-mix(in srgb, var(--color-gold) 30%, transparent);
      border-radius: 0.15em;
      padding: 0 0.1em;
      color: inherit;
    }
  `,
})
export class ContentEditor {
  private readonly session = inject(ENTITY_SESSION);
  /**
   * The EntityDocument key of the prose Field this editor renders (ADR-0051): {@link VIEW_FIELD_KEY} when
   * a Field placed the View (so `content` and `secrets` each get their own editor), else the canonical
   * `content` key when placed by id or mounted bare (a spec).
   */
  private readonly fieldKey = inject(VIEW_FIELD_KEY, { optional: true }) ?? CONTENT_FIELD.id;
  private readonly destroyRef = inject(DestroyRef);
  // The shared id→name resolver backs both the `@` picker (its entity list) and
  // every entityLink node view; provided at the entities/:id route so navigating
  // gets a fresh owner list. The route-level EnvironmentInjector is what each node
  // view is created in, so they resolve the very same instance (ADR-0023).
  private readonly resolver = inject(EntityNameResolver);
  // The `::` picker's vocabulary source (#96): the owner's last-saved DISTINCT descriptors.
  private readonly entities = inject(EntitiesClient);
  private readonly environmentInjector = inject(EnvironmentInjector);
  // ContentEditor's own node injector — lives inside the router outlet, so the
  // entityLink node views created from it can resolve ActivatedRoute for routerLink.
  private readonly injector = inject(Injector);
  private readonly appRef = inject(ApplicationRef);
  // The `[[Target#Heading]]` anchor a link navigated to (ADR-0033), read from the
  // route fragment so an in-note or cross-note jump both land on the right heading.
  private readonly fragment = toSignal(inject(ActivatedRoute).fragment);

  /** The editor's accessible name, localized by the caller (ADR-0014). */
  readonly ariaLabel = input.required<string>();

  private readonly slashMenu = viewChild(SlashMenu);
  private readonly entityPicker = viewChild(EntityPicker);
  private readonly descriptorPicker = viewChild(DescriptorPicker);
  // Two instances of the one free-text picker, keyed by template ref (ADR-0033).
  private readonly displayPicker = viewChild('displayPicker', {
    read: LinkTextPicker,
  });
  private readonly headingPicker = viewChild('headingPicker', {
    read: LinkTextPicker,
  });

  // Recreated on every seed rather than reset: a fresh Editor gets empty undo
  // history for free (Ctrl-Z can't reach past the seed), and the directives re-bind
  // via their signal inputs. Null until the first seed, so mount doesn't double-construct.
  protected readonly editor = signal<Editor | null>(null);

  /** True while the live doc holds edits not yet committed into the body — the {@link LiveEditor} flag. */
  private readonly _hasPendingCommit = signal(false);

  /** The doc last committed (or seeded), stringified: an `update` re-serialising to this is normalisation, not an edit (#164). */
  private committed = '';

  /** The latest uncommitted doc awaiting the debounce, or null when in sync with the body. */
  private pendingDoc: JSONContent | null = null;
  private commitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect((onCleanup) => {
      const editor = this.editor();
      if (!editor) return;
      const onDocChanged = ({ editor }: { editor: Editor }) => this.onDocChanged(editor.getJSON());
      editor.on('update', onDocChanged);
      onCleanup(() => editor.off('update', onDocChanged));
    });

    // Label .ProseMirror (not the wrapper) — TipTap sets role="textbox" on it.
    effect(() => {
      const editor = this.editor();
      if (!editor) return;
      editor.view.dom.setAttribute('aria-label', this.ariaLabel());
    });

    // A read-only opener (canWrite:false, ADR-0037) can't edit the prose — so autosave
    // never fires and the session never hits a 403. Reacts to the editor swap and writable.
    effect(() => {
      const editor = this.editor();
      if (!editor) return;
      // emitUpdate=false: setEditable defaults to firing an `update`, which would push the
      // editor's current prose back into the session and clobber a just-adopted re-seed before
      // the seed effect reads it (Reseeded → Original race). Toggling editability isn't an edit.
      editor.setEditable(this.session.writable(), false);
    });

    // Seed only when loadGeneration ticks (fresh load, reload, swap) — and on first mount. Never on
    // an edit echo: a commit bumps no generation, so it can't rebuild the editor or jump the cursor.
    // A remount within one load (the Map↔Note toggle, #75) re-seeds from the destroy-flushed body.
    let seededGeneration = -1;
    effect(() => {
      const generation = this.session.loadGeneration();
      if (generation === seededGeneration) return;
      seededGeneration = generation;
      // untracked: sample the body once; tracking it would rebuild the editor on every commit.
      const content = untracked(() => this.session.doc()[this.fieldKey]) as Content | undefined;
      // A placeholder body ({}) or malformed snapshot yields an empty editor — a fresh note, a
      // prose-less reload, or a document at rest this build cannot parse.
      const rawSnapshot = content?.snapshot;
      const snapshot = isDocSnapshot(rawSnapshot) ? rawSnapshot : undefined;
      const previous = untracked(this.editor);
      const next = this.createEditor(snapshot);
      // Baseline against the parsed doc, so a load-time normalisation `update` reads value-equal (#164).
      this.committed = JSON.stringify(next.getJSON());
      this.clearPending();
      this.editor.set(next);
      // Destroy after TiptapDirective mounts the new surface (next render) so there's
      // no blank frame between old DOM out and new DOM in.
      queueMicrotask(() => previous?.destroy());
    });

    // Anchor scroll (ADR-0033): when the route fragment or the mounted editor
    // changes, best-effort scroll to the first heading whose text matches — how a
    // `[[Target#Heading]]` link lands on its heading. Re-runs on re-seed so a jump
    // that also swaps the open Entity still finds the heading in the fresh doc.
    // afterRenderEffect, not effect: on a re-seed the fresh editor.view.dom is only
    // mounted into the page by TiptapDirective *after* this CD's DOM write, and
    // scrollIntoView on a still-detached node is a silent no-op — so the cross-note
    // jump (new Entity, new editor) needs the post-render beat, not just in-note.
    afterRenderEffect(() => {
      const editor = this.editor();
      const fragment = this.fragment();
      if (!editor || !fragment) return;
      scrollToHeading(editor.view.dom, fragment);
    });

    // Register so a save flushes the pending doc first, and dirty accounts for it (ADR-0051).
    this.destroyRef.onDestroy(
      this.session.registerEditor({
        hasPendingCommit: this._hasPendingCommit,
        flushPendingCommit: () => this.commit(),
      }),
    );

    // Flush into the body first so a remount re-seeds the latest prose (#75), then destroy.
    this.destroyRef.onDestroy(() => {
      this.commit();
      this.editor()?.destroy();
    });
  }

  /** Buffer a TipTap `update` and arm the debounce; a doc value-equal to the baseline is normalisation, not an edit (#164). */
  private onDocChanged(json: JSONContent): void {
    // ponytail: JSON.stringify equality — ProseMirror JSON has deterministic key order, so this is
    // sound for doc snapshots; swap for a deep-equal if a snapshot ever holds non-PM data.
    if (JSON.stringify(json) === this.committed) {
      this.clearPending();
      return;
    }
    this.pendingDoc = json;
    this._hasPendingCommit.set(true);
    if (this.commitTimer !== null) clearTimeout(this.commitTimer);
    this.commitTimer = setTimeout(() => this.commit(), COMMIT_DEBOUNCE_MS);
  }

  /**
   * Fold the pending doc into the body through `mutate`, discarding the patches — TipTap keeps its
   * own history (ADR-0051). Runs on the debounce, and synchronously on flush-before-save and
   * teardown. A no-op when already in sync.
   */
  private commit(): void {
    if (this.commitTimer !== null) {
      clearTimeout(this.commitTimer);
      this.commitTimer = null;
    }
    const doc = this.pendingDoc;
    if (doc === null) return;
    this.session.mutate((body) => {
      body[this.fieldKey] = tiptapContent(doc);
    });
    this.committed = JSON.stringify(doc);
    this.clearPending();
  }

  /** Drop the pending doc and clear the dirty flag — after a commit, a re-seed, or a no-op update. */
  private clearPending(): void {
    this.pendingDoc = null;
    this._hasPendingCommit.set(false);
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
        return ({ node }) => createEntityLinkNodeView(node, environmentInjector, elementInjector, appRef);
      },
    });

    // Same pattern for the callout node view (ADR-0033): swap the framework-free
    // schema node for one carrying the Angular view. No elementInjector — the
    // callout chrome has no routerLink to resolve.
    const calloutWithView = calloutNode.extend({
      addNodeView() {
        return ({ node, editor, getPos }) => createCalloutNodeView(node, editor, getPos, environmentInjector, appRef);
      },
      // ArrowUp from the top line of a callout body focuses its type input (arrow-key
      // navigation into the chrome); elsewhere it returns false and cursor motion is normal.
      addKeyboardShortcuts() {
        return { ArrowUp: () => focusCalloutTypeAtTop(this.editor) };
      },
    });

    const mention = entityMention(
      () => this.entityPicker(),
      (query) => this.resolver.search(query),
    );

    // The owner's descriptor vocabulary, fetched lazily on the first `::` and cached for
    // this editor's life. ponytail: a reload recreates the editor and refreshes it, so a
    // newly-saved descriptor is suggested next session — last-saved state, by design (#96).
    let vocab: Promise<string[]> | undefined;
    const descriptor = descriptorSuggestion(
      () => this.descriptorPicker(),
      () => (vocab ??= firstValueFrom(this.entities.listDescriptors().pipe(catchError(() => of<string[]>([]))))),
    );

    // The `|` display and `#` heading triggers (ADR-0033): free-text siblings of `::`,
    // armed only directly after an entityLink so both chars stay literal in prose.
    const display = linkTextSuggestion({
      name: 'displaySuggestion',
      char: '|',
      attr: 'display',
      getPicker: () => this.displayPicker(),
    });
    const heading = linkTextSuggestion({
      name: 'headingSuggestion',
      char: '#',
      attr: 'heading',
      getPicker: () => this.headingPicker(),
    });

    // Patch /link to flag the mention extension before inserting @, so onExit knows
    // to clean up the stray @ if the user escapes instead of picking (finding #5/#9).
    const slashItems = SLASH_ITEMS.map((item) =>
      item.id !== 'link'
        ? item
        : {
            ...item,
            apply: (editor: Editor, range: { from: number; to: number }) => {
              mention.setProgrammatic();
              editor.chain().focus().deleteRange(range).insertContent('@').run();
            },
          },
    );

    return new Editor({
      extensions: [
        ...CONTENT_EXTENSIONS.filter((e) => {
          const name = (e as { name?: string }).name;
          return name !== entityLinkNode.name && name !== calloutNode.name;
        }),
        entityLinkWithView,
        calloutWithView,
        slashCommands(() => this.slashMenu(), slashItems),
        mention.extension,
        descriptor,
        display,
        heading,
      ],
      content,
    });
  }
}

/**
 * Best-effort scroll to the first heading whose text matches `fragment` (ADR-0033).
 * Case-insensitive on trimmed text, so `[[Target#History]]` finds `## History`. No
 * match is a silent no-op — anchors are advisory, a renamed/removed heading must not
 * error. `fragment` arrives percent-encoded (a heading may have spaces), so decode it.
 */
function scrollToHeading(root: HTMLElement, fragment: string): void {
  const target = decodeFragment(fragment).trim().toLowerCase();
  if (!target) return;
  const headings = Array.from(root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'));
  for (const heading of headings) {
    if ((heading.textContent ?? '').trim().toLowerCase() === target) {
      heading.scrollIntoView({ block: 'start' });
      return;
    }
  }
}

/** A malformed percent-sequence must not throw (best-effort anchor); fall back to the raw fragment. */
function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

/** A malformed/placeholder snapshot (e.g. `{}`) leaves the editor on its empty doc rather than throwing. */
function isDocSnapshot(snapshot: unknown): snapshot is JSONContent {
  return typeof snapshot === 'object' && snapshot !== null && (snapshot as { type?: unknown }).type === 'doc';
}
