/**
 * The Content plugin's framework-free half (ADR-0051). Angular- and TipTap-free by construction, so
 * the API imports it as a bundled plugin: it carries the domain's former `content/` seam (content-node,
 * visit, entity-link, extract-text, extract-outline), the `core.datatype.rich-content` data-type and its
 * canonical {@link CONTENT_FIELD}, and `core.type.note`. The Angular half — the editor, the slash menu, the
 * TipTap directive, the translation scope — lives behind `@hexly/plugin-content/web`.
 */
export * from './lib';
export * from './vocab-items';
