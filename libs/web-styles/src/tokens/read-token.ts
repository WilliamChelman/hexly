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
 * The element a renderer resolves tokens from: the document root. A World Theme is applied there
 * (ADR-0076) and every tier is declared there and nowhere else (ADR-0077), so the root is the one
 * element that answers for the whole chain rather than half of it.
 */
export function designTokenStyle(): CSSStyleDeclaration {
  return getComputedStyle(document.documentElement);
}
