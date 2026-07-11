# plugins

The **bundled plugins** (CONTEXT.md → Type Definition, ADR-0048): the Entity Types Hexly compiles in,
declared once through `defineType` and consumed by both sides — the API resolves a plugin's Field
schema for forward-only validation and faceting, the web registers its bespoke View.

Framework-free on purpose: a plugin's _declaration_ (id, label, Fields) is shared, while its Angular
view lives in the web app beside the core Views it registers alongside.
