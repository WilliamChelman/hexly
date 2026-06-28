import { Extension } from '@tiptap/core';
import Suggestion, {
  SuggestionKeyDownProps,
  SuggestionProps,
} from '@tiptap/suggestion';
import { SLASH_ITEMS, SlashItem, filterSlashItems } from './slash-menu-items';
import { SlashMenu } from './slash-menu';

/**
 * The `/` trigger for the Content editor's slash menu (#73). A non-schema extension
 * (it adds a ProseMirror plugin, no node/mark), so it stays out of {@link CONTENT_EXTENSIONS}
 * and changes no format contract (ADR-0019). It owns the trigger/query/keyboard plumbing
 * via `@tiptap/suggestion` and drives the {@link SlashMenu} chrome through `getMenu`, which is
 * deferred so the editor can be built before its `viewChild` resolves.
 *
 * `items` defaults to `SLASH_ITEMS`; callers can override to patch individual items
 * (e.g. ContentEditor patches `/link` to set the programmatic-trigger flag).
 */
export function slashCommands(
  getMenu: () => SlashMenu | undefined,
  items: SlashItem[] = SLASH_ITEMS,
): Extension {
  return Extension.create({
    name: 'slashCommands',
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashItem, SlashItem>({
          editor: this.editor,
          char: '/',
          allow: ({ state }) => !state.selection.$from.parent.type.spec.code,
          items: ({ query }) => filterSlashItems(items, query),
          // The selected item knows how to insert itself; range covers the typed "/query".
          command: ({ editor, range, props }) => props.apply(editor, range),
          render: () => ({
            onStart: (props: SuggestionProps<SlashItem, SlashItem>) =>
              getMenu()?.open(props),
            onUpdate: (props: SuggestionProps<SlashItem, SlashItem>) =>
              getMenu()?.update(props),
            onKeyDown: (props: SuggestionKeyDownProps) =>
              getMenu()?.onKeyDown(props.event) ?? false,
            onExit: () => getMenu()?.close(),
          }),
        }),
      ];
    },
  });
}
