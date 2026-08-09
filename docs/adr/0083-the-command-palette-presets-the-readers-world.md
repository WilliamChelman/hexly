# The Command Palette presets the reader's World

`EntityQuickOpen` is a root singleton that searches Entities **globally** — every Entity the caller can reach, in
every World — and deliberately avoids injecting `ActiveWorld`, reading the World off the URL instead so that World
scope stays out of a root singleton. **It now searches the World the reader is in and the Containers that World
Mounts**, and is registered under the `/w/:worldId` lifetime rather than the root one, so it injects `ActiveWorld`
cleanly — which is what ADR-0032's lifetime-scoped provider registry is for.

The driver is relevance, not the search language. A Palette that surfaces an NPC from a campaign closed six months
ago is noise: the reader is in a World, and Quick Open exists to get them somewhere within it. Cross-World movement
is not lost, only indirected — `WorldQuickOpen` is a separate provider on the same empty prefix, so switching World
is one keystroke in the same overlay.

**Mounts are included**, not the World's own Container alone. That keeps **Sealed**'s promise true — a
**Compendium Entry** is findable by search, and it lives in a Compendium rather than in any World, so a
World-only scope would make sealed content unfindable for the packs a reader actually draws on. It also makes
`$in:` meaningful in the Palette (ADR-0082).

Worth keeping straight in the vocabulary: this makes the Palette _scoped like_ a **link-target read** while
remaining a **navigation read**. Same reach, different question — a link-target read also gates Assets and
re-ranks; a navigation read does neither. The scopes coincide; the rules do not, and the two concepts must not
collapse into one because of it.

**Outside a World the provider does not exist**, so the Palette offers Worlds and Commands and no Entities. That
falls out of the lifetime registration rather than being a second rule, and it is coherent: a reader with no World
in view has no Entities in view. The cost is real and accepted — someone who remembers an Entity's name but not
its World must pick a World first.

The preset is **not escapable**. No "search all Worlds" toggle: the **Entity Browser** is non-escapably scoped to
its World and nobody minds, and an escape hatch would need a scope control on a surface with no room for one.
Under ADR-0082 it would also have nowhere to live — the World scope is not a Facet anyone named, so it belongs to
neither the text store nor the rail store.

## Considered Options

- **Keep the global scope** — the status quo, and the reason the Palette is CONTEXT.md's exemplar of an unscoped
  navigation read. Rejected on relevance, and it would also have left the Palette the one surface where ADR-0082's
  vocabulary could not resolve World-defined Fields at all.
- **World's own Container only, no Mounts** — simpler to state, but it silently removes **Compendium Entries**
  from search, contradicting **Sealed**, and it makes the Palette narrower than the **Library** the same reader
  browses.
- **Global fallback outside a World** — keeps entity search working on the World Index, but requires a second
  provider with a second scope rule, reintroducing the inconsistency this removes for the sake of a rare case.
- **A "search everywhere" escape hatch** — rejected: no home for the state, no room on the surface, and the
  Palette already switches World in the same keystroke.

## Consequences

- `EntityQuickOpen` moves from `providedIn: 'root'` to the World route's providers and injects `ActiveWorld`; the
  URL-parsing `worldIdInUrl` helper and the sealed-entry navigation-context workaround it fed both retire, since
  the active World is now known directly.
- Quick Open results can come from a Mounted Container, so a result row may be a **Sealed** entry — already
  handled, and now reached by scope rather than by chance.
- CONTEXT.md's **Command Palette**, **Link-target read**, **Sealed** and **Entity Browser** entries are amended;
  the Palette is no longer described as global.
- Independent of ADR-0081 and ADR-0082 — this is true whether or not **Facet Tokens** ever ship — but sequenced
  before them, so the Palette's typeahead is built against its final scope.
