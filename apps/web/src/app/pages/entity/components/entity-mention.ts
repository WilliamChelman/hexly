import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, {
  SuggestionKeyDownProps,
  SuggestionProps,
} from '@tiptap/suggestion';
import { EntitySummary } from '@hexly/domain';
import { filterEntities } from './entity-mention-items';
import { EntityPicker } from './entity-picker';

/**
 * The `@` trigger for inserting a Content Entity Link (issue #95, ADR-0023).
 * Like {@link slashCommands}, a non-schema extension (it adds a ProseMirror plugin,
 * no node/mark) so it stays out of {@link CONTENT_EXTENSIONS} and changes no format
 * contract (ADR-0019). It filters the owner's Entity summaries client-side as the
 * user types — unfiltered by type or self — and a pick inserts the `entityLink`
 * atom, snapshotting the name as `label`. `getEntities`/`getPicker` are deferred so
 * the editor builds before the resolver list and the picker's `viewChild` resolve.
 * The `/link` slash item routes here by inserting `@`.
 */
export function entityMention(
  getPicker: () => EntityPicker | undefined,
  getEntities: () => Promise<EntitySummary[]>,
): Extension {
  return Extension.create({
    name: 'entityMention',
    addProseMirrorPlugins() {
      return [
        Suggestion<EntitySummary, EntitySummary>({
          editor: this.editor,
          // Distinct key: slashCommands already owns the default `suggestion` key,
          // and two suggestion plugins can't share one in the same editor.
          pluginKey: new PluginKey('entityMention'),
          char: '@',
          allow: ({ state }) => !state.selection.$from.parent.type.spec.code,
          items: ({ query }) => getEntities().then((list) => filterEntities(list, query)),
          command: ({ editor, range, props }) =>
            editor
              .chain()
              .focus()
              .deleteRange(range)
              .insertEntityLink({ entityId: props.id, label: props.name })
              .run(),
          render: () => ({
            onStart: (props: SuggestionProps<EntitySummary, EntitySummary>) =>
              getPicker()?.open(props),
            onUpdate: (props: SuggestionProps<EntitySummary, EntitySummary>) =>
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
