import { Editor, Extension } from '@tiptap/core';
import { PluginKey, Transaction } from '@tiptap/pm/state';
import Suggestion, { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import { EntitySummary } from '@hexly/domain';
import { EntityLinkAttrs } from '@hexly/plugin-content';
import { EntityPickerComponent } from '../components/entity-picker.component';
import { entityLinkNode } from './entity-link-node';
import { MentionCreate, MentionCreateDetails, MentionItem, mentionItems, parseMentionQuery } from './mention-items';

/** What the editor supplies the `@` trigger; each callback is deferred so the editor builds first. */
export interface EntityMentionPorts {
  getPicker: () => EntityPickerComponent | undefined;
  /** The owner's Entities matching the typed name, server-side (ADR-0025 `q`). */
  search: (name: string) => Promise<EntitySummary[]>;
  /**
   * Mint the Entity the `Create "…"` row names, under the Instance's Inline Creation knobs and in
   * the host Entity's World (ADR-0073). Rejects when the write fails; the typed text is restored.
   */
  mint: (name: string) => Promise<EntitySummary>;
  /**
   * The `Create "…" with details…` row: the same mint through the create dialog, resolving `null` when
   * the author cancels (ADR-0073) — cancelling then leaves the typed text exactly as `Esc` would.
   */
  mintWithDetails: (name: string) => Promise<EntitySummary | null>;
}

/**
 * The `@` trigger for inserting a Content Entity Link (ADR-0023). A non-schema extension
 * (ProseMirror plugin, no node/mark), so it stays out of {@link CONTENT_EXTENSIONS}. It
 * searches the owner's Entity summaries server-side as the user types — unfiltered by type
 * or self (ADR-0025 `q`) — and a pick inserts the `entityLink` atom, snapshotting the name
 * as `label`.
 *
 * The picker's last two rows mint the typed name and link it (ADR-0073): `Create "…"` in one gesture,
 * unconditionally — no Type filter and no modal, because an unfilled `required` Field no longer refuses
 * a write (ADR-0074) — and `Create "…" with details…` through the create dialog, for an author who asks
 * for it.
 *
 * `setProgrammatic` flags an `@` inserted by code (the `/link` slash item) rather than typed;
 * `onExit` then removes the stray `@` if the user escaped instead of picking.
 */
export function entityMention(ports: EntityMentionPorts): { extension: Extension; setProgrammatic: () => void } {
  let programmatic = false;
  let picked = false;

  return {
    setProgrammatic: () => (programmatic = true),
    extension: Extension.create({
      name: 'entityMention',
      addProseMirrorPlugins() {
        return [
          Suggestion<MentionItem, MentionItem>({
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
            items: async ({ query }) => {
              const parsed = parseMentionQuery(query);
              return mentionItems(parsed, await ports.search(parsed.name));
            },
            command: ({ editor, range, props }) => {
              if (programmatic) picked = true;
              if (props.kind === 'entity') {
                editor
                  .chain()
                  .focus()
                  .deleteRange(range)
                  .insertEntityLink(linkTo(props.entity, props.descriptor))
                  .run();
                return;
              }
              // `programmatic` is sampled here, not read at resolution: `onExit` clears it the moment
              // the popup closes, long before a dialog comes back.
              mintAndLink(
                editor,
                range,
                props,
                props.kind === 'create' ? ports.mint : ports.mintWithDetails,
                !programmatic,
              );
            },
            render: () => ({
              onStart: (props: SuggestionProps<MentionItem, MentionItem>) => ports.getPicker()?.open(props),
              onUpdate: (props: SuggestionProps<MentionItem, MentionItem>) => ports.getPicker()?.update(props),
              onKeyDown: (props: SuggestionKeyDownProps) => ports.getPicker()?.onKeyDown(props.event) ?? false,
              onExit: (props: SuggestionProps<MentionItem, MentionItem>) => {
                // If /link triggered this session and the user escaped (no pick),
                // remove the programmatically-inserted @ so it doesn't litter the doc.
                if (programmatic && !picked) {
                  props.editor.chain().deleteRange(props.range).run();
                }
                programmatic = false;
                picked = false;
                ports.getPicker()?.close();
              },
            }),
          }),
        ];
      },
    }),
  };
}

/** The attrs a picked or minted Entity becomes as an `entityLink` (ADR-0023). */
function linkTo(entity: EntitySummary, descriptor: string | null): EntityLinkAttrs {
  return { entityId: entity.id, label: entity.name, descriptor };
}

/**
 * Mint the named Entity and drop its link where the mention was typed.
 *
 * The typed text goes *before* the await: `@tiptap/suggestion` fires `onExit` the instant the popup
 * closes, so the suggestion range is dead by the time the write lands (ADR-0073) — which is also what
 * lets the details row's dialog outlive the popup. The insertion point is the captured one, mapped
 * through every transaction since — the author keeps writing across the round trip, and the link belongs
 * in the sentence they left it in, not under the caret they have since moved.
 *
 * A failed write puts the typed text back the same way. So does declining the dialog (`null`) — unless
 * the `@` came from `/link`, which is ours to remove, so cancelling then reads exactly like `Esc` at the
 * picker: we clean up what we inserted, never what you typed.
 */
function mintAndLink(
  editor: Editor,
  range: { from: number; to: number },
  row: MentionCreate | MentionCreateDetails,
  mint: (name: string) => Promise<EntitySummary | null>,
  restoreOnDecline: boolean,
): void {
  const typed = editor.state.doc.textBetween(range.from, range.to);
  editor.chain().focus().deleteRange(range).run();

  // Bias left (-1): text the author types at this very position belongs *after* the pending link,
  // so the mention keeps its place in the sentence rather than being pushed to the end of it.
  let at = range.from;
  const track = ({ transaction }: { transaction: Transaction }) => (at = transaction.mapping.map(at, -1));
  editor.on('transaction', track);

  void mint(row.name).then(
    (entity) =>
      finish(() => {
        if (entity) insertAt(editor, at, { type: entityLinkNode.name, attrs: linkTo(entity, row.descriptor) });
        else if (restoreOnDecline) insertAt(editor, at, typed);
      }),
    () => finish(() => insertAt(editor, at, typed)),
  );

  function finish(insert: () => void): void {
    editor.off('transaction', track);
    if (!editor.isDestroyed) insert();
  }
}

/**
 * Insert at a tracked position without moving the caret: the author owns it. With nothing typed since,
 * `at` *is* the caret, and mapping carries it past the new node — so the ordinary case still lands the
 * cursor after the link.
 */
function insertAt(editor: Editor, at: number, content: Parameters<Editor['commands']['insertContentAt']>[1]): void {
  editor.chain().focus().insertContentAt(at, content, { updateSelection: false }).run();
}
