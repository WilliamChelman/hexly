import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, {
  SuggestionKeyDownProps,
  SuggestionProps,
} from '@tiptap/suggestion';
import { DescriptorPicker } from './descriptor-picker';
import {
  DescriptorItem,
  descriptorItems,
  entityLinkPosBefore,
  setLinkDescriptor,
} from './descriptors';

/**
 * The `::` trigger that characterises a Content Entity Link (issue #96, ADR-0023). Like
 * {@link entityMention}, a non-schema extension — it adds a ProseMirror plugin, no
 * node/mark — so it stays out of {@link CONTENT_EXTENSIONS} and changes no format contract
 * (ADR-0019). It **arms only when the node immediately before the cursor is an
 * `entityLink`** ({@link entityLinkPosBefore}); everywhere else `::` is literal text.
 * Selecting a suggestion — or the typed free text — sets that link's `descriptor` attr
 * (set/change/clear), sourced from the World's last-saved vocabulary. `fetchVocab` is a
 * type-ahead: it takes the live `::` query and returns the matching descriptors, so the
 * picker lists on the fly per keystroke. `getPicker`/`fetchVocab` are deferred so the
 * editor builds before the picker `viewChild` and the client resolve.
 */
export function descriptorSuggestion(
  getPicker: () => DescriptorPicker | undefined,
  fetchVocab: (query: string) => Promise<string[]>,
): Extension {
  return Extension.create({
    name: 'descriptorSuggestion',
    addProseMirrorPlugins() {
      return [
        Suggestion<DescriptorItem, DescriptorItem>({
          editor: this.editor,
          // Distinct key: each suggestion plugin in an editor needs its own (slashCommands
          // and entityMention own the others).
          pluginKey: new PluginKey('descriptorSuggestion'),
          char: '::',
          // The single rule: a link must sit immediately before the `::` (and not in code),
          // so `::` is plain text in ordinary prose.
          allow: ({ state, range }) =>
            !state.selection.$from.parent.type.spec.code &&
            entityLinkPosBefore(state, range.from) !== null,
          items: async ({ query }) => descriptorItems(query, await fetchVocab(query)),
          command: ({ editor, range, props }) => {
            // Recompute against the live state: the link sits just before the `::query`.
            const linkPos = entityLinkPosBefore(editor.state, range.from);
            if (linkPos === null) return;
            setLinkDescriptor(editor, linkPos, props.descriptor, range);
          },
          render: () => ({
            onStart: (props: SuggestionProps<DescriptorItem, DescriptorItem>) =>
              getPicker()?.open(props),
            onUpdate: (props: SuggestionProps<DescriptorItem, DescriptorItem>) =>
              getPicker()?.update(props),
            onKeyDown: (props: SuggestionKeyDownProps) =>
              getPicker()?.onKeyDown(props.event) ?? false,
            onExit: () => getPicker()?.close(),
          }),
        }),
      ];
    },
  });
}
