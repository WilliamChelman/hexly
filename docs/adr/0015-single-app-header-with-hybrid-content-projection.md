# Single app header with hybrid content projection

> **Status: superseded by ADR-0022.** The single shell header, `HeaderService`, and the `header`-named outlet are replaced by a persistent global nav rail (which absorbs the brand, theme toggle, and language switcher) plus page-owned headers. The history below records why the single header existed.

Today there is no app-level header: `App` is a bare `<router-outlet />`, and each feature grows its own divergent top chrome — the theme toggle lives only inside `app-editor-header`, while map-library and login each roll their own. The new language switcher (ADR-0014) needs one home, not three. We are consolidating to a **single `AppHeader` in the root shell**, into which pages inject their own content through a **hybrid** mechanism: a stateful signal-based service for simple declarative content, and a **named router-outlet** for rich interactive content.

## What we decided

- **One header, owned by the root shell.** `App` renders a single always-present `AppHeader` above the routed `<router-outlet />`. The header owns the global chrome that every page shares: brand/logo, the **theme toggle** (relocated out of `app-editor-header`), and the new **language switcher**. Per-feature headers are dissolved.

- **Pages inject content two ways, by complexity.**
  - **Stateful `HeaderService` (signals)** for *simple declarative* content a page sets on activation — eyebrow/title/breadcrumb text, a primary action label. The page writes to the service; the header reads the signals.
  - **Named `<router-outlet name="header">`** for *rich interactive* content that is really a component — the editor's map-title input and Share control. The route declares a header component for the named outlet.
  - **Heuristic:** plain text/state → service; interactive component → named outlet.

## Considered options

- **Service-only (every page pushes a view-model the header renders).** Rejected: the editor's header content (an editable title bound to the map, the Share control) is interactive and stateful — modelling it as serialized data the header re-renders would reinvent component composition.
- **Named-outlet-only (every page projects a header component).** Rejected: overkill for pages whose header is just a title/breadcrumb string; a one-line service write is far lighter than a dedicated routed component.
- **Keep per-feature headers, just add the switcher to each.** Rejected: it duplicates global chrome (theme + language) across three divergent headers, which is exactly the drift this removes — and ADR-0014 needs a single, predictable home for the switcher reachable by every actor, including anonymous public-link viewers.

## Consequences

- **`app-editor-header` is decomposed.** Its global bits (brand, theme toggle) move into `AppHeader`; its page-specific bits (map title, Share) become the editor's header component projected into the named outlet.
- **This is a prerequisite phase for the i18n work** (ADR-0014): the language switcher lands in `AppHeader` first, so the string migration never has to touch three headers that are about to be replaced.
- **Routes that contribute interactive header content** gain a `header`-named outlet entry; routes with only declarative header content use the service and need no outlet.
- **No `CONTEXT.md` change.** "Header" is layout/composition, not domain vocabulary.
