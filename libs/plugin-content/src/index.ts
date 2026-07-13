/**
 * The Content plugin's framework-free half (ADR-0051). Angular- and TipTap-free by construction, so
 * the API could import it. Today it carries only the vocabulary-row helper shared by the editor's
 * pickers; the domain's `content/` seam and the `core.rich-content` data-type move in with the
 * collapse. The Angular half — the editor, the slash menu, the TipTap directive, the translation
 * scope — lives behind `@hexly/plugin-content/web`.
 */
export * from './vocab-items';
