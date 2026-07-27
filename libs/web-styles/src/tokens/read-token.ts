import { DesignToken, designToken } from './manifest';

/** The value the manifest declares for a token — its `@property` `initial-value` (ADR-0075). */
export function designTokenInitial(name: DesignToken): string {
  return designToken(name).initial;
}

/**
 * A token's value as the document resolved it, falling back to {@link designTokenInitial} — one
 * fallback rather than a hex per Canvas renderer (ADR-0075). Only jsdom takes it.
 *
 * A derived token resolves to `oklch()`, so this string is a colour only to a CSS parser: a renderer
 * that brings its own needs the pixel a `fillStyle` round-trip reads back.
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
