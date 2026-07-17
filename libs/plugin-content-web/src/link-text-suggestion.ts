import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import { LinkTextPicker } from './link-text-picker.component';
import { entityLinkPosBefore, linkTextRows, setLinkAttr } from './descriptors';
import { VocabItem } from '@hexly/plugin-content';

/**
 * The `|` display (`[[Target|text]]`) and `#` heading (`[[Target#Heading]]`) triggers on an
 * `entityLink` (ADR-0033). It **arms only when the node immediately before the cursor is an
 * `entityLink`** ({@link entityLinkPosBefore}); everywhere else the char is literal text.
 * There is no vocabulary — {@link linkTextRows} offers just the typed text — and picking it
 * sets the `attr` on that link via {@link setLinkAttr}. When the attr is already set, an empty
 * query offers a "Remove" row (blank value, which clears) — the only way to un-set it short of
 * deleting the link. `getPicker` is deferred so the editor builds before the picker
 * `viewChild` resolves.
 */
export function linkTextSuggestion(opts: {
  name: string;
  char: string;
  attr: 'display' | 'heading';
  getPicker: () => LinkTextPicker | undefined;
}): Extension {
  const { name, char, attr, getPicker } = opts;
  return Extension.create({
    name,
    addProseMirrorPlugins() {
      return [
        Suggestion<VocabItem, VocabItem>({
          editor: this.editor,
          // Distinct key: each suggestion plugin in an editor needs its own.
          pluginKey: new PluginKey(name),
          char,
          // Display text and heading names are multi-word — keep the query open across
          // spaces (default stops at the first one), committing on Enter/Tab instead.
          allowSpaces: true,
          allow: ({ state, range }) =>
            !state.selection.$from.parent.type.spec.code && entityLinkPosBefore(state, range.from) !== null,
          // On an empty query the cursor sits right after the trigger char, so the link is
          // exactly `from - char.length` — the same position `command` resolves. (Non-empty
          // queries don't need `current`; the lookup lands in text and yields null, fine.)
          items: ({ query, editor }) => {
            const st = editor.state;
            const linkPos = entityLinkPosBefore(st, st.selection.from - char.length);
            const current = (linkPos !== null ? st.doc.nodeAt(linkPos)?.attrs[attr] : null) as string | null;
            return linkTextRows(query, current ?? null);
          },
          command: ({ editor, range, props }) => {
            const linkPos = entityLinkPosBefore(editor.state, range.from);
            if (linkPos === null) return;
            setLinkAttr(editor, linkPos, attr, props.value, range);
          },
          render: () => ({
            onStart: (props: SuggestionProps<VocabItem, VocabItem>) => getPicker()?.open(props),
            onUpdate: (props: SuggestionProps<VocabItem, VocabItem>) => getPicker()?.update(props),
            onKeyDown: (props: SuggestionKeyDownProps) => getPicker()?.onKeyDown(props.event) ?? false,
            onExit: () => getPicker()?.close(),
          }),
        }),
      ];
    },
  });
}
