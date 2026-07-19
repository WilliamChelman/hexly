import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { Editor, JSONContent } from '@tiptap/core';
import { Content } from '@hexly/plugin-content';
import { CONTENT_EXTENSIONS } from '../extensions/content-extensions';

/**
 * A read-only render of a `core.rich-content` value — the *static* face of prose a host surface embeds
 * in place (the Board's Text Block, #268). Mounts a non-editable TipTap over the same
 * {@link CONTENT_EXTENSIONS} the Content editor uses, so formatting reads identically; inline **Entity
 * Links** fall back to their label text (no live-name node view — a static preview needs no route/resolver).
 *
 * The editable twin is {@link ContentEditorComponent}; a Text Block swaps to it on arm. Kept in the
 * content plugin so TipTap stays behind `plugin-content-web` (ADR-0051) — a host imports the pair through
 * `@hexly/plugin-content/editor`, never `@tiptap/core` directly.
 */
@Component({
  selector: 'app-content-display',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `<div #host [attr.aria-label]="ariaLabel()" class="flex flex-col"></div>`,
  styles: `
    @reference '#app-styles.css';

    :host ::ng-deep .ProseMirror {
      @apply outline-none;
    }
    :host ::ng-deep .ProseMirror > :first-child {
      margin-top: 0;
    }
    :host ::ng-deep .ProseMirror > :last-child {
      margin-bottom: 0;
    }
    :host ::ng-deep .ProseMirror p {
      margin: 0.4em 0;
    }
    :host ::ng-deep .ProseMirror h1,
    :host ::ng-deep .ProseMirror h2,
    :host ::ng-deep .ProseMirror h3 {
      @apply font-semibold;
      margin: 0.5em 0 0.2em;
    }
    :host ::ng-deep .ProseMirror h1 {
      font-size: 1.5em;
    }
    :host ::ng-deep .ProseMirror h2 {
      font-size: 1.25em;
    }
    :host ::ng-deep .ProseMirror ul,
    :host ::ng-deep .ProseMirror ol {
      margin: 0.4em 0;
      padding-left: 1.4em;
    }
    :host ::ng-deep .ProseMirror ul {
      list-style: disc;
    }
    :host ::ng-deep .ProseMirror ol {
      list-style: decimal;
    }
    :host ::ng-deep .ProseMirror a {
      @apply text-gold underline;
    }
  `,
})
export class ContentDisplayComponent {
  /** The `core.rich-content` value to render, read-only. */
  readonly content = input.required<Content>();
  /** The render's accessible name, localized by the host (ADR-0014). */
  readonly ariaLabel = input<string>();

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private editor: Editor | null = null;

  constructor() {
    // Mount once the host div is in the DOM, then push each new document in via setContent — TipTap keeps
    // no cursor/history here (read-only), so a re-render never fights an author's caret.
    afterRenderEffect(() => {
      const element = this.host().nativeElement;
      const doc = docOf(this.content());
      if (!this.editor) {
        this.editor = new Editor({ element, extensions: CONTENT_EXTENSIONS, content: doc, editable: false });
      } else {
        this.editor.commands.setContent(doc);
      }
    });
    inject(DestroyRef).onDestroy(() => this.editor?.destroy());
  }
}

/** The renderable doc for a Content value — an empty doc for a placeholder or a format this build can't read. */
function docOf(content: Content): JSONContent {
  const snapshot = content.snapshot;
  return isDocSnapshot(snapshot) ? snapshot : { type: 'doc', content: [] };
}

/** A malformed/placeholder snapshot (e.g. `{}`) renders as an empty doc rather than throwing. */
function isDocSnapshot(snapshot: unknown): snapshot is JSONContent {
  return typeof snapshot === 'object' && snapshot !== null && (snapshot as { type?: unknown }).type === 'doc';
}
