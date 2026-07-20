import { ChangeDetectionStrategy, Component, computed, effect, inject, input, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { TextElement } from '@hexly/plugin-board';
import { ContentEditorComponent } from '@hexly/plugin-content/editor';
import { ENTITY_SESSION, VIEW_FIELD_KEY } from '@hexly/web-entity';
import { BoardStore } from '../services/board-store';
import { TextBlockSession, TEXT_CONTENT_KEY } from '../services/text-block-session';

/**
 * A **Text Block** Board Element (#268): rich text authored on the surface, static until its Text Block
 * arms, then edited in place with the *same editor as an Entity's Content* (CONTEXT.md → Text Block).
 *
 * One renderer for both faces: the {@link ContentEditorComponent} — familiar formatting, the slash menu,
 * inline **Entity Links** — over a {@link TextBlockSession} that folds edits back into this element,
 * `editable` only while armed and static (read-only) otherwise. A single renderer is what keeps the read
 * and edit faces pixel-identical (live link names, descriptors, spacing); the former read-only twin drifted
 * from the editor on each of those. The host is `pointer-events` gated so a static block's presses fall
 * through to the element box (select / drag / resize), and an armed block captures them for typing —
 * which is why arm/disarm gates dragging: the two never contend for the pointer.
 *
 * Provides the editor's session seam locally: `ENTITY_SESSION` is re-bound to the adapter (overriding the
 * route's real board session) and `VIEW_FIELD_KEY` to the adapter's private content key, so the reused
 * Content editor reads and writes the Text Block's prose and nothing else.
 */
@Component({
  selector: 'app-board-text-block',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block w-full h-full overflow-auto text-ink text-sm',
    '[class.pointer-events-none]': '!armed()',
  },
  imports: [ContentEditorComponent, TranslocoPipe],
  providers: [
    TextBlockSession,
    { provide: ENTITY_SESSION, useExisting: TextBlockSession },
    { provide: VIEW_FIELD_KEY, useValue: TEXT_CONTENT_KEY },
  ],
  template: `
    <!-- One Content renderer for both faces (#268): the same editor, editable only while armed — static
         otherwise, when it mirrors the block's prose read-only. A single renderer keeps read and edit
         pixel-identical (live Entity-Link names, descriptors, spacing) with no drift between two paths. -->
    <app-content-editor class="tb-editor" [editable]="armed()" [ariaLabel]="'board.canvas.textBlock' | transloco" />
  `,
  // Neutralise the Content editor's page chrome (its min-height, border, and reading padding) so it fits
  // the Text Block's box instead of a note's reading column; the box supplies the frame and scroll.
  styles: `
    @reference '#app-styles.css';

    :host ::ng-deep .tb-editor {
      @apply min-h-0 border-0 rounded-none bg-transparent px-2 py-1;
    }
  `,
})
export class TextBlockComponent {
  /** The Text Block element this renders — its `core.rich-content` value and geometry. */
  readonly element = input.required<TextElement>();

  private readonly store = inject(BoardStore);
  private readonly session = inject(TextBlockSession);
  private readonly editor = viewChild(ContentEditorComponent);

  /** Whether this Text Block is the armed element — the one flip between static display and live editing. */
  protected readonly armed = computed(() => this.store.armed() === this.element().id);

  constructor() {
    // Bind the adapter to this element's id up front — long before a click can arm it — so the editor
    // seeds from and commits to the right Text Block, and a flush-on-disarm still lands (see TextBlockSession).
    effect(() => this.session.setTarget(this.element().id));
  }

  /**
   * Focus the live editor, caret at the end. Called by the elements overlay when this block arms:
   * arming without moving focus left the keyboard on `<body>`, so the very next Backspace hit the
   * surface layer and deleted the whole element out from under the "open" editor.
   */
  focus(): void {
    this.editor()?.focus();
  }
}
