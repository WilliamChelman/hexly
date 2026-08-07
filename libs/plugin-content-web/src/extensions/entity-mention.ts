import { Editor, Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import { EntitySummary, FacetKeySet } from '@hexly/domain';
import { EntityLinkAttrs } from '@hexly/plugin-content';
import { EntityPickerComponent } from '../components/entity-picker.component';
import { entityLinkNode } from './entity-link-node';
import {
  MentionCreate,
  MentionCreateDetails,
  MentionItem,
  MentionQuery,
  mentionFacetKeys,
  mentionItems,
  parseMentionQuery,
} from './mention-items';
import { takeMention } from './pending-mention';

/** What the editor supplies the `@` trigger; each callback is deferred so the editor builds first. */
export interface EntityMentionPorts {
  getPicker: () => EntityPickerComponent | undefined;
  /**
   * The owner's Entities matching the typed name, server-side (ADR-0025 `q`) and narrowed by whatever
   * **Facet Tokens** were typed with it (ADR-0082), minus the one being written in — the host indexes
   * the mention as prose the moment it autosaves (ADR-0035).
   */
  search: (query: MentionQuery) => Promise<EntitySummary[]>;
  /**
   * This surface's Facet vocabulary, read synchronously off the client registry (ADR-0082), so
   * `@$type:npc gorb` narrows to NPCs and a `$` name nothing answers to narrows nothing.
   */
  facetKeys: () => FacetKeySet;
  /**
   * Whether the caller may create Entities in the host Entity's World — the `create-entity` Right
   * (ADR-0039). False withholds both Create rows entirely (ADR-0073); picking is untouched.
   */
  canCreate: () => boolean;
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
 * searches the owner's Entity summaries server-side as the user types — never the host
 * ({@link EntityMentionPorts.search}), and unfiltered by type unless a **Facet Token** typed into the
 * mention says otherwise (`@$type:npc gorb`, ADR-0082) — and a pick inserts the `entityLink` atom,
 * snapshotting the name as `label`.
 *
 * The picker's last two rows mint the typed name and link it (ADR-0073): `Create "…"` in one gesture,
 * unconditionally — no Type filter and no modal, because an unfilled `required` Field no longer refuses
 * a write (ADR-0074) — and `Create "…" with details…` through the create dialog, for an author who asks
 * for it. Both are withheld from a caller without create rights in the host World: Inline Creation is a
 * write, so it inherits the Contributor gate.
 *
 * `setProgrammatic` flags an `@` inserted by code (the `/link` slash item) rather than typed;
 * `onExit` then removes the stray `@` if the user escaped instead of picking.
 */
export function entityMention(ports: EntityMentionPorts): { extension: Extension; setProgrammatic: () => void } {
  let programmatic = false;
  let picked = false;
  // Distinct key: slashCommands already owns the default `suggestion` key, and two suggestion plugins
  // can't share one in the same editor. Held here so the caret can be read off the plugin's own range.
  const pluginKey = new PluginKey('entityMention');

  /** State the `$` names this World answers to nothing — never a silent reinterpretation (ADR-0082). */
  const stateMisses = (query: string) =>
    ports.getPicker()?.showFacetMiss(parseMentionQuery(query, ports.facetKeys()).facets);

  return {
    setProgrammatic: () => (programmatic = true),
    extension: Extension.create({
      name: 'entityMention',
      addProseMirrorPlugins() {
        return [
          Suggestion<MentionItem, MentionItem>({
            editor: this.editor,
            pluginKey,
            char: '@',
            // Entity names are multi-word ("Jane Doe") — keep the query open across spaces so
            // the server search sees the full name (default stops at the first space).
            allowSpaces: true,
            allow: ({ state }) => {
              const { $from } = state.selection;
              return !$from.parent.type.spec.code && !$from.marks().some((m) => m.type.name === 'code');
            },
            items: async ({ editor, query }) => {
              // A `$` name being typed owns the list: the residual text is half a token, so Enter has
              // to complete the key rather than search for — or mint — the fragment (ADR-0082).
              const keys = mentionFacetKeys(query, caretIn(editor, pluginKey, query), ports.facetKeys());
              if (keys.length > 0) return keys;
              const parsed = parseMentionQuery(query, ports.facetKeys());
              return mentionItems(parsed, await ports.search(parsed), ports.canCreate());
            },
            command: ({ editor, range, props }) => {
              if (props.kind === 'facet-key') {
                // Accepting a key rewrites exactly the `$…` being typed and leaves the mention open, so
                // the value is typed straight after the colon — the mention is not picked by this.
                const queryStart = range.from + 1; // past the `@`
                editor
                  .chain()
                  .focus()
                  .insertContentAt({ from: queryStart + props.from, to: queryStart + props.to }, props.key + ':')
                  .run();
                return;
              }
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
              onStart: (props: SuggestionProps<MentionItem, MentionItem>) => {
                stateMisses(props.query);
                ports.getPicker()?.open(props);
              },
              onUpdate: (props: SuggestionProps<MentionItem, MentionItem>) => {
                // On the keystroke, not with the rows: a miss is stated while the search is still out.
                stateMisses(props.query);
                ports.getPicker()?.update(props);
              },
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

/**
 * How far into the mention query the caret stands. `allowSpaces` matches to the end of the line rather
 * than to the caret, so the query can run past it — and typeahead completes what is being typed, never
 * what follows it. Falls back to the whole query where the plugin holds no range yet.
 */
function caretIn(editor: Editor, key: PluginKey, query: string): number {
  const range = (key.getState(editor.state) as { range?: { from: number } } | undefined)?.range;
  if (!range) return query.length;
  // `range.from` is the `@` itself, one character wide.
  return Math.max(0, Math.min(query.length, editor.state.selection.from - range.from - 1));
}

/** The attrs a picked or minted Entity becomes as an `entityLink` (ADR-0023). */
function linkTo(entity: EntitySummary, descriptor: string | null): EntityLinkAttrs {
  return { entityId: entity.id, label: entity.name, descriptor };
}

/**
 * Mint the named Entity and land its link where the mention was typed; {@link takeMention} holds that
 * place across the round trip. A failed write or a declined dialog puts the typed text back — except an
 * `@` we inserted ourselves (`/link`), which is ours to remove (ADR-0073).
 */
function mintAndLink(
  editor: Editor,
  range: { from: number; to: number },
  row: MentionCreate | MentionCreateDetails,
  mint: (name: string) => Promise<EntitySummary | null>,
  restoreOnDecline: boolean,
): void {
  const pending = takeMention(editor, range);

  void mint(row.name).then(
    (entity) => {
      if (entity) pending.land({ type: entityLinkNode.name, attrs: linkTo(entity, row.descriptor) });
      else if (restoreOnDecline) pending.restore();
      else pending.discard();
    },
    () => pending.restore(),
  );
}
