import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import { EntitySummary } from '@hexly/domain';
import { EntityPicker } from './entity-picker.component';

/**
 * The `@` trigger for inserting a Content Entity Link (ADR-0023). A non-schema extension
 * (ProseMirror plugin, no node/mark), so it stays out of {@link CONTENT_EXTENSIONS}. It
 * searches the owner's Entity summaries server-side as the user types — unfiltered by type
 * or self (ADR-0025 `q`) — and a pick inserts the `entityLink` atom, snapshotting the name
 * as `label`. `search`/`getPicker` are deferred so the editor builds before the resolver and
 * the picker's `viewChild` resolve.
 *
 * `setProgrammatic` flags an `@` inserted by code (the `/link` slash item) rather than typed;
 * `onExit` then removes the stray `@` if the user escaped instead of picking.
 */
export function entityMention(
  getPicker: () => EntityPicker | undefined,
  search: (query: string) => Promise<EntitySummary[]>,
): { extension: Extension; setProgrammatic: () => void } {
  let programmatic = false;
  let picked = false;

  return {
    setProgrammatic: () => (programmatic = true),
    extension: Extension.create({
      name: 'entityMention',
      addProseMirrorPlugins() {
        return [
          Suggestion<EntitySummary, EntitySummary>({
            editor: this.editor,
            // Distinct key: slashCommands already owns the default `suggestion` key,
            // and two suggestion plugins can't share one in the same editor.
            pluginKey: new PluginKey('entityMention'),
            char: '@',
            // Entity names are multi-word ("Jane Doe") — keep the query open across spaces so
            // the server search sees the full name (default stops at the first space).
            allowSpaces: true,
            allow: ({ state }) => {
              const { $from } = state.selection;
              return !$from.parent.type.spec.code && !$from.marks().some((m) => m.type.name === 'code');
            },
            items: ({ query }) => search(query),
            command: ({ editor, range, props }) => {
              if (programmatic) picked = true;
              editor
                .chain()
                .focus()
                .deleteRange(range)
                .insertEntityLink({ entityId: props.id, label: props.name })
                .run();
            },
            render: () => ({
              onStart: (props: SuggestionProps<EntitySummary, EntitySummary>) => getPicker()?.open(props),
              onUpdate: (props: SuggestionProps<EntitySummary, EntitySummary>) => getPicker()?.update(props),
              onKeyDown: (props: SuggestionKeyDownProps) => getPicker()?.onKeyDown(props.event) ?? false,
              onExit: (props: SuggestionProps<EntitySummary, EntitySummary>) => {
                // If /link triggered this session and the user escaped (no pick),
                // remove the programmatically-inserted @ so it doesn't litter the doc.
                if (programmatic && !picked) {
                  props.editor.chain().deleteRange(props.range).run();
                }
                programmatic = false;
                picked = false;
                getPicker()?.close();
              },
            }),
          }),
        ];
      },
    }),
  };
}
