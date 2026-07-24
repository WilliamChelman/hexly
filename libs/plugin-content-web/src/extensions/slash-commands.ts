import { Extension } from '@tiptap/core';
import Suggestion, { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import { SLASH_ITEMS, SlashItem, filterSlashItems } from '../models/slash-menu-items';
import { SlashMenuComponent } from '../components/slash-menu.component';

/**
 * The `/` trigger for the Content editor's slash menu. Drives the {@link SlashMenuComponent} chrome
 * through `getMenu`, which is deferred so the editor can be built before its `viewChild`
 * resolves. `items` can be overridden to patch individual items.
 */
export function slashCommands(
  getMenu: () => SlashMenuComponent | undefined,
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
            onStart: (props: SuggestionProps<SlashItem, SlashItem>) => getMenu()?.open(props),
            onUpdate: (props: SuggestionProps<SlashItem, SlashItem>) => getMenu()?.update(props),
            onKeyDown: (props: SuggestionKeyDownProps) => getMenu()?.onKeyDown(props.event) ?? false,
            onExit: () => getMenu()?.close(),
          }),
        }),
      ];
    },
  });
}
