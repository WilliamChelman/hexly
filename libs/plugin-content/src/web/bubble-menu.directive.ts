import { Directive, ElementRef, effect, inject, input } from '@angular/core';
import type { Editor } from '@tiptap/core';
import { BubbleMenuPlugin } from '@tiptap/extension-bubble-menu';

const PLUGIN_KEY = 'formattingBubbleMenu';

/**
 * Registers the TipTap BubbleMenuPlugin for the host element. Chrome-only wiring (ADR-0019):
 * applied in ContentEditor's template, not in CONTENT_EXTENSIONS.
 *
 * The plugin lives and dies with the editor instance: when the `editor` input swaps it
 * re-registers on the fresh one and unregisters from the old (unless already destroyed).
 */
@Directive({ selector: '[appBubbleMenu]' })
export class BubbleMenuDirective {
  readonly editor = input.required<Editor>();
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    effect((onCleanup) => {
      const editor = this.editor();
      editor.registerPlugin(
        BubbleMenuPlugin({
          editor,
          element: this.el.nativeElement,
          pluginKey: PLUGIN_KEY,
          // Debounce appearance so the menu settles after a selection rather than
          // flickering during the drag. Dismissal stays instant: an action collapses
          // the selection (FormattingMenu.dismiss), and the plugin only debounces
          // non-empty selections — an empty one hides on the spot.
          updateDelay: 250,
        }),
      );
      onCleanup(() => {
        if (!editor.isDestroyed) editor.unregisterPlugin(PLUGIN_KEY);
      });
    });
  }
}
