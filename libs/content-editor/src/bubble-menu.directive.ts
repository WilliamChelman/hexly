import { Directive, ElementRef, effect, inject, input } from '@angular/core';
import type { Editor } from '@tiptap/core';
import { BubbleMenuPlugin } from '@tiptap/extension-bubble-menu';

const PLUGIN_KEY = 'formattingBubbleMenu';

/**
 * Registers the TipTap BubbleMenuPlugin for the host element given an editor.
 * Chrome-only wiring (ADR-0019): applied in ContentEditor's template, not in CONTENT_EXTENSIONS.
 *
 * The plugin lives and dies with the editor instance. ContentEditor recreates the editor on
 * each seed, so when the `editor` input swaps this effect re-registers on the fresh one;
 * its cleanup unregisters from the old (unless that editor was already destroyed).
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
