# Persistent global nav rail, and page-owned headers

The single app header (ADR-0015) crammed three jobs into one bar — global chrome (brand, user menu, theme, language), the routed page's own controls, and, on a hexmap, the whole map-editing toolbar — flanking page content with global chrome that has a different lifetime and concern. We are pulling **all global chrome out of the header into a persistent left nav rail** (the app shell), leaving the **header entirely page-owned**. This **supersedes ADR-0015**: the single shell header, its `HeaderService` signals, and its `router-outlet name="header"` are removed.

## What we decided

- **The shell is a docked global nav rail and nothing else.** `App` renders the rail beside a bare `<router-outlet />`. The rail is the only persistent chrome; it owns everything app-level: brand/logo, primary navigation (Library, Styleguide…), and — nested behind the avatar — appearance (theme, language) and account (display name, Sign out). This is the single, predictable home global chrome lacked.

- **The rail is collapsed by default and expands to labels.** Collapsed it is a ~48px icon strip, present at **every viewport**. Expanding reveals labels beside the icons and nothing more (quick-switch, recents, and search are deferred — YAGNI). Expansion is **responsive, driven by viewport not page**: on wide viewports it **pushes** the page aside and the open state is remembered/pinnable; on narrow viewports it **overlays** the page transiently and collapses on click-away.

- **The rail docks; editor chrome still floats (clarifies ADR-0013).** The rail is *shell* chrome and legitimately docks at the far left; the editor body stays full-bleed *within its region*, and the tool palette and side panels still float over the canvas. In the editor this puts two vertical strips on the left — the dark docked rail and the light floating tool palette — which we **accept**: the dark/flush vs light/floating contrast keeps app-nav and editor-tools legibly separate (like an IDE activity bar beside a tool panel).

- **The header is page-owned.** There is no shell header. Each routed page renders its own bar, a custom one, or none. A reusable **slotted header component** is the drift-killer ADR-0015's single header used to provide: it owns the header frame (height, baseline, border) and exposes `leading` / `title` / `actions` projection slots. Simple pages (Library, Note) project an eyebrow + title; **the editor uses the same component**, projecting its contenteditable title + Editing/Conflict chip into `title` and Save/Share into `actions`. (ADR-0026 later replaces the Save button + Editing/Conflict chips with one autosave status chip; Share stays.) A page may still skip it for a fully bespoke bar.

- **The anonymous public-link viewer gets a reduced rail.** A viewer reaching a single entity through a public link (ADR-0004: closed user set) cannot browse the Library, so their rail shows brand + appearance + a Login action and **no navigation rows** — no doors they can't open. `/login` itself renders standalone, with no rail.

## Considered options

- **Tighten the existing single top bar** (collapse all global chrome into one right-side avatar menu, keep ADR-0015's mechanism). Rejected: smallest diff, but brand + account still flank the page's controls in one bar, so the conceptual mismatch — global and contextual concerns sharing a row — remains.
- **Overlay drawer instead of a persistent rail** (global chrome hidden behind a hamburger, summoned on demand). Rejected: it reclaims the most editor space, but global navigation is then always a click away and hidden by default; a persistent rail keeps nav one click and some branding always visible, which we valued over the reclaimed sliver.
- **Floating account card, no rail.** Rejected: lightest touch, but leaves primary navigation homeless — the exact gap this set out to close.
- **Keep a shell-owned header frame** (named-outlet-only, or the full hybrid). Rejected: once all global chrome leaves the header, the header is purely the page's; a shell that still owns it re-asserts central control the pages no longer need. A reusable component everyone *opts into* narrows drift without a mandatory shell header.

## Consequences

- **ADR-0015 is superseded.** `app-header`, `header.service.ts`, and the `header`-named outlet entries in the routes are deleted. The editor header's **All Maps** and **Design System** buttons are dropped — both are navigation now living in the rail.
- **The theme toggle and language switcher (ADR-0014) move from the user menu into the rail** (behind the avatar). They keep a single predictable home reachable by every actor, including anonymous viewers — the property ADR-0015 introduced them to have.
- **A new `EditorHeader` consumes the shared slotted header component** rather than rendering a bespoke bar, so the richest, most drift-prone header reuses the same frame as the plain pages.
- **No `CONTEXT.md` change.** "Rail", "header", "drawer" are layout/composition, not domain vocabulary — consistent with ADR-0013 and ADR-0015.
