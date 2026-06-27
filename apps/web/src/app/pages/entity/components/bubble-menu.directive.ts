import { Directive, ElementRef, effect, inject, input } from '@angular/core';
import type { Editor } from '@tiptap/core';
import { BubbleMenuPlugin } from '@tiptap/extension-bubble-menu';

const PLUGIN_KEY = 'formattingBubbleMenu';

/**
 * Registers the TipTap BubbleMenuPlugin for the host element given an editor.
 * Chrome-only wiring (ADR-0019): applied in NoteView's template, not in CONTENT_EXTENSIONS.
 *
 * The plugin lives and dies with the editor instance. NoteView recreates the editor on
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
          // Default is 250ms, which makes the menu lag behind the selection and linger
          // after an action; show/hide it in step with the selection.
          updateDelay: 0,
        }),
      );
      onCleanup(() => {
        if (!editor.isDestroyed) editor.unregisterPlugin(PLUGIN_KEY);
      });
    });
  }
}
