/**
 * `@hexly/plugin-content/editor` — the Content editing surface, exposed for a *host surface* that embeds
 * prose in place: the Board's **Text Block** (#268), the free-positioned twin of an Entity's Content. It
 * is rendered with the very same {@link ContentEditorComponent} — so formatting, the slash menu, and
 * inline **Entity Links** behave identically (CONTEXT.md → Text Block). It is the *one* Content renderer:
 * its `editable` input drives both faces (static when false), so the read and edit views can never drift.
 *
 * A separate entry point from the eager `/web` barrel by design (ADR-0051): everything here is
 * TipTap-bound, so it must never ride the initial bundle. Only a deferred View chunk (the board View's
 * `loadComponent`) imports it — exactly as the content View's own chunk reaches the editor.
 */
export { ContentEditorComponent } from './components/content-editor.component';
