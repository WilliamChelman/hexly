import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import { DescriptorPicker } from './descriptor-picker';
import { entityLinkPosBefore, setLinkAttr } from './descriptors';
import { VocabItem, vocabItems } from '../vocab-items';

/**
 * The `::` trigger that characterises a Content Entity Link (ADR-0023). A non-schema
 * extension (ProseMirror plugin, no node/mark), so it stays out of {@link CONTENT_EXTENSIONS}.
 * It **arms only when the node immediately before the cursor is an `entityLink`**
 * ({@link entityLinkPosBefore}); everywhere else `::` is literal text. Selecting a
 * suggestion — or the typed free text — sets that link's `descriptor` attr
 * (set/change/clear). `getPicker`/`loadVocab` are deferred so the editor builds before
 * the picker `viewChild` and the client resolve.
 */
export function descriptorSuggestion(
  getPicker: () => DescriptorPicker | undefined,
  loadVocab: () => Promise<string[]>,
): Extension {
  return Extension.create({
    name: 'descriptorSuggestion',
    addProseMirrorPlugins() {
      return [
        Suggestion<VocabItem, VocabItem>({
          editor: this.editor,
          // Distinct key: each suggestion plugin in an editor needs its own (slashCommands
          // and entityMention own the others).
          pluginKey: new PluginKey('descriptorSuggestion'),
          char: '::',
          // Descriptors are multi-word ("capital of") — keep the query open across spaces
          // (default stops at the first), committing on Enter/Tab.
          allowSpaces: true,
          // The single rule: a link must sit immediately before the `::` (and not in code),
          // so `::` is plain text in ordinary prose.
          allow: ({ state, range }) =>
            !state.selection.$from.parent.type.spec.code && entityLinkPosBefore(state, range.from) !== null,
          items: async ({ query }) => vocabItems(query, await loadVocab()),
          command: ({ editor, range, props }) => {
            // Recompute against the live state: the link sits just before the `::query`.
            const linkPos = entityLinkPosBefore(editor.state, range.from);
            if (linkPos === null) return;
            setLinkAttr(editor, linkPos, 'descriptor', props.value, range);
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
