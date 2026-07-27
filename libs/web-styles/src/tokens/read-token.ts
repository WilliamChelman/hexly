import { DesignToken, designToken } from './manifest';

/** The value the manifest declares for a token — its `@property` `initial-value` (ADR-0075). */
export function designTokenInitial(name: DesignToken): string {
  return designToken(name).initial;
}

/**
 * A token's value as the document resolved it, falling back to {@link designTokenInitial}. The three
 * Canvas renderers ADR-0075 names each carried their own hex for the unresolved case — a second copy of
 * the palette with nothing holding it to the first. Only jsdom takes the fallback: a registered property
 * always resolves in a browser.
 */
export function readDesignToken(style: CSSStyleDeclaration, name: DesignToken): string {
  return style.getPropertyValue(name).trim() || designTokenInitial(name);
}

/**
 * The element a renderer resolves tokens from: the document root, never a descendant. A World Theme is
 * applied there (ADR-0076) and the tier-2 roles are declared only there (ADR-0075), so a deeper element
 * carrying its own `data-color-scheme` resolves *its* Palette anchors while still inheriting the root's
 * already-derived roles — half a repaint, in silence. The root cannot straddle that boundary.
 */
export function designTokenStyle(): CSSStyleDeclaration {
  return getComputedStyle(document.documentElement);
}
