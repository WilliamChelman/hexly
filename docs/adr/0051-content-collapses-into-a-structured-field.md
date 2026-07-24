# Content collapses into a Structured Field, and the Note ships as a plugin

ADR-0050 collapsed **Payload Kind** into **Structured Field** by asking what a Payload Kind was, that a
Field was not — and finding nothing but where the value was stored. It then stopped one step short. It
declared:

> **The Entity body is `{ content, metadata }`. One shape, for every Entity, forever.** `rich-content` was
> never an addon; it is the base, and no Type declares it.

That "forever" does not survive the same question. **What is Content, that a Structured Field is not?** Both
are a value with its own schema, its own edge harvester, and its own View. Content differs only in being
stored at the body root rather than in the Metadata map, and in being guaranteed rather than declared. The
first difference is the exact one ADR-0050 deleted. The second is a courtesy, and it costs the seam.

So Content collapses too, and the last thing `apps/web` and `libs/domain` know about a body shape goes with it.

## Decision

**The Entity body _is_ the Metadata map.** `EntityBody` is deleted; there is no wrapper and no second store.
Prose is a **Structured Field** like any other: the `core.rich-content` data-type, at the `content` key,
declared by the Types that mean to carry prose.

- **Every Type that carries prose declares the same canonical `CONTENT_FIELD`** — key `content`, data-type
  `core.rich-content`. `core.note` declares it and nothing else; `core.hexmap` declares it beside the grid;
  `dnd.monster` declares it beside its thirteen stats; the World Types editor hands it to a user-defined
  type behind a default-on **has prose** toggle. `resolveFields` already dedupes by key (`field.ts:206`), so
  a multi-type Entity resolves exactly one — no rule, no enforcement, no special case.

- **A Type without it has no prose.** The guarantee is gone, deliberately. This is what ADR-0048 always
  promised — _"a missing plugin leaves them as plain Metadata"_ — and #199's content floor (an unregistered
  type affords `core.view.content` so _"the Entity opens on the lore it has always had"_) was a courtesy that
  only worked while Content was the base. Once it isn't, the courtesy is a lie: it claims a Field the absent
  plugin never declared. **It is withdrawn.** An Entity whose Type this build does not register affords the
  generic Field view alone, its prose among the values it shows unrendered — uniformly with every other
  Field, and with no second resolution path keyed off the stored value.

- **`StructuredDataType` grows two capabilities**, both optional, both threaded through the explicitly-composed
  registry exactly as `harvestEdges` already is:
  - `extractText?(value)` — the searchable text the value carries. `entity-writes.derive()` stops calling
    `extractText(body.content)` and asks the registry instead. FTS becomes generic; a grid may now contribute
    its Hex and Region names to search, which it could not before.
  - `vault` — the **Vault Projection** (CONTEXT.md): `'body' | 'frontmatter' | 'omit'`, plus `toMarkdown` /
    `fromMarkdown`. The Field declares it; the data-type supplies the default. `core.rich-content` projects to
    `body`, `core.hex-grid` to `frontmatter`. This pulls forward the per-data-type export strategy ADR-0050
    explicitly deferred (_"a later decision that needs no design space reserved now"_) — the collapse is what
    made it un-deferrable, because Metadata could no longer be defined as "the frontmatter map" once the prose
    was in it.

- **Several body Fields are allowed.** A `world.deity` may hold `content` and `secrets`, affording two content
  Views exactly as #202 gave one Entity two grids. They export in Field order, each block preceded by
  `<!-- hexly:field <key> -->` — emitted **only when there is more than one**, so an ordinary Note is still
  plain Markdown, byte-for-byte. An unmarked body imports into the first body Field. The vault importer
  **splits on markers before conversion**, so the marker never reaches `fromMarkdown` — ADR-0033 degrades
  Markdown comments on import, and a marker that its own converter ate would round-trip to nothing.

- **The Note ships as `libs/plugin-content`** — the rename of `libs/content-editor`, and the second plugin
  with a server half:
  - `@hexly/plugin-content` — framework-free. The whole of `libs/domain/src/lib/content/` (`content-node`,
    `visit`, `entity-link`, `extract-text`, `extract-outline`), the markdown↔ProseMirror converter lifted out
    of `libs/obsidian`, `CONTENT_FIELD`, the `core.rich-content` data-type, and the `core.note` `defineType()`.
  - `@hexly/plugin-content/web` — one symbol, `providePluginContent()`: `core.note`'s chrome, the
    `core.view.content` View (TipTap, the slash menu, the Outline dock), and the `content` translation scope.
  - `libs/obsidian` keeps the file walk, the frontmatter, and the assets, and resolves body-vs-frontmatter off
    the registry it is already handed. It does **not** import the content plugin: the converter reaches it as
    `core.rich-content`'s projection, the same way the grid does.

- **The write channel.** TipTap is not a render-from-state view — it owns a live doc, a cursor, and a
  ProseMirror history — which is precisely why ADR-0048 excepted Content from `mutate`. It cannot stay
  excepted, because a `secrets` Field must be edited by the same component through `VIEW_FIELD_KEY`, and a
  reserved `_content` buffer cannot serve it. So each editor instance owns its live doc for its own key and
  **commits through `session.mutate` on a short debounce**, discarding the returned patches — TipTap keeps its
  own undo, exactly as `HexMapStore` keeps its own patch stack. It reads _from_ the store only when
  `loadGeneration` ticks, the same reset seam `HexMapStore` already uses. `_content`, `_baseContent`, and
  `setContent` are deleted. `dirty` OR-s in "an editor holds an uncommitted doc", and `save()` and the
  `beforeunload` guard **flush** every live editor first, so the debounce window cannot eat the last keystrokes.

**The acceptance tests** are that `libs/domain` contains zero occurrences of "content" and "tiptap", and that
`apps/web` names no Entity Type and no View but `core.view.fields` — the generic fallback, the one View that
is genuinely the app's. `apps/web/src/app/entity-types/core-types.ts` is deleted; `CORE_VIEW_CONTENT` and
`CORE_VIEW_MAP` leave `libs/web-entity` for their plugins.

## Considered Options

- **Leave Content as the base body and pluginize only the editor** — the small cut: `core.rich-content` and
  the `content/` seam stay in `libs/domain`, and `libs/plugin-content/web` ships just the View. Rejected: it
  keeps the special case and merely relocates the code, and it cannot deliver a second prose Field, because a
  reserved body key has no room for one. The goal was a clean seam, not a smaller diff.
- **The domain injects `CONTENT_FIELD` into every type's schema** (`resolveFields` prepends it) — keeps the
  floor: every Entity has prose, plugin present or absent. Rejected: a Field the domain hard-codes is not a
  Field, it is the base wearing a Field's clothes, and `libs/domain` would still name `core.rich-content`.
- **Self-describing structured values** (`{ kind: 'core.rich-content', format, snapshot }`), so a View resolves
  from the _value_ when the declaring plugin is absent — would have made the absent-plugin path strictly
  better than today's. Rejected: it declares the kind twice, in the Field and in the value, where they can
  disagree, and it opens a second resolution path beside the registry one ADR-0050 built. Uniformity beat the
  courtesy.
- **One body Field per Entity, enforced** (a second prose Field must project to frontmatter) — rejected once
  the marker comment showed that several bodies round-trip fine. Enforcing it would have made a _type set_
  illegal for the first time in the model, since two types can claim the body under different keys.
- **First body Field in resolved order wins; the rest demote silently** — rejected for the reason ADR-0050
  rejected implicit view ordering: reordering an Entity's types would silently change the shape of its
  exported file.
- **`## Heading` sections instead of comment markers** — readable in a vault, but a heading in the prose can
  collide with a section name and re-import wrong. The marker is unambiguous and invisible.
- **Per-keystroke `mutate`** — the literal one-write-channel. Rejected: `produceWithPatches` with
  `enablePatches()` deep-freezes a fresh `editor.getJSON()` on every keypress and mints an undo patch holding
  a full copy of the document, and the echo it creates has to be guarded against or the cursor jumps.

## Consequences

- **Reverses ADR-0050's "one shape, for every Entity, forever"** and its `{ content, metadata }` body, and
  supersedes ADR-0048's Content-as-base. `EntityBody`, `entityBodySchema`'s `content` key, and `_content` are
  deleted. `libs/domain` declares no Entity Type at all: `CORE_TYPES` and `CORE_NOTE_TYPE` go with the plugin.
- **Amends ADR-0019.** Its ruling that the `content/` seam is _"the single place that knows the snapshot shape"_
  stands — the seam is still single, it has simply moved to `libs/plugin-content`, and its five consumers
  (`entity-writes`, `vault-export`, `vault-import`, `markdown-to-pm`, `entity.ts`) now reach it through the
  data-type's capabilities rather than by importing it. The registered extension set and the `format` tag are
  unchanged, and remain the plugin's contract.
- **Amends ADR-0033 again.** ADR-0050 closed the grid's export lossiness as a side-effect; this closes the
  frontmatter/body question generically, and adds the field-marker convention to the vault format.
- **Amends ADR-0026.** `dirty` is no longer "content reference OR body reference" but body reference alone,
  plus the editors' pending-commit flag; the flush-before-save is new.
- **Withdraws #199's content floor.** An Entity with an unregistered type used to open on its lore; it now
  opens on the generic Field view. This is a real regression on the one case users hit — a `dnd.monster` on a
  build without the D&D plugin — accepted in exchange for one resolution path and no privileged data-type.
- **A build with no content plugin has no prose editor.** This is not a hypothetical to be shipped: the content
  plugin is core in practice, and `libs/obsidian` is useless without it. It is a plugin for the seam, not for
  the optionality — the same reason `core.hexmap` kept the `core.` namespace (ADR-0050: _"going through the
  plugin seam"_ does not make you a third party).
- **No data migration.** Existing documents carry `content` at the body root and will not parse against the new
  store. Hexly is pre-production; staging is wiped, as it was for ADR-0050.
- CONTEXT.md: **Content** stops being a place on the Entity and becomes a data-type; **Metadata** stops
  meaning "the frontmatter map" and becomes the one body, with frontmatter as one projection of it;
  **Vault Projection** is new; **Note** is the type that declares only the Content Field.
