import { EnvironmentProviders, InjectionToken, makeEnvironmentProviders, provideAppInitializer } from '@angular/core';
import type { LucideIconData } from '@lucide/angular';

/**
 * A glyph drawn as inline SVG (ADR-0007): the `<svg>` inner `body` markup plus the root `attrs` that
 * vary per glyph. Both the app's bespoke glyphs and Lucide's normalise to this shape —
 * {@link lucideGlyph} converts Lucide's node data into it.
 */
export interface SvgGlyph {
  readonly name: string;
  readonly attrs: string;
  readonly body: string;
}

/**
 * A glyph drawn from an **icon font**: the single `char` the font maps to the symbol, in `fontFamily`.
 * Registered via {@link fontGlyph}, its font loaded through {@link provideIconFont} — the seam a plugin
 * uses to draw symbols shipped as a font rather than SVG (e.g. a game's bespoke glyph font). It renders
 * as text, so it inherits the caller's `font-size` and `currentColor` like any character.
 */
export interface FontGlyph {
  readonly name: string;
  readonly char: string;
  readonly fontFamily: string;
}

/**
 * One glyph the `<app-icon>` dispatcher can draw, keyed by a stable `name` (ADR-0007): either inline
 * {@link SvgGlyph} markup or a {@link FontGlyph} character. The dispatcher and the registry it reads
 * speak this one representation, so a plugin extends the vocabulary with either kind.
 */
export type IconGlyph = SvgGlyph | FontGlyph;

/** Narrow an {@link IconGlyph} to the font-backed kind (vs. the SVG kind). */
export function isFontGlyph(glyph: IconGlyph): glyph is FontGlyph {
  return 'char' in glyph;
}

/** The `<svg>` root attrs Lucide glyphs are drawn with (its house stroke, lightened to 1.6). */
const LUCIDE_ATTRS = 'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';

/**
 * Serialize a Lucide icon's node list (`[tag, attrs]` pairs) to SVG inner markup. `key` is
 * React-reconciliation metadata Lucide ships in the data, and is dropped.
 */
function lucideBody(data: LucideIconData): string {
  return data.node
    .map(([tag, attrs]) => {
      const a = Object.entries(attrs)
        .filter(([k]) => k !== 'key')
        .map(([k, v]) => `${k}="${v}"`)
        .join(' ');
      return `<${tag} ${a} />`;
    })
    .join('');
}

/**
 * Wrap a Lucide icon (e.g. `LucideSkull`) as an {@link IconGlyph} under a stable `name` — the form a
 * plugin registers via {@link provideIcons} so its type can wear a Lucide glyph web-ui's core set
 * omits, rather than smuggling the glyph into web-ui's central vocabulary (ADR-0007, #192).
 */
export function lucideGlyph(name: string, source: { readonly icon: LucideIconData }): SvgGlyph {
  return { name, attrs: LUCIDE_ATTRS, body: lucideBody(source.icon) };
}

/**
 * Register an icon-font symbol as an {@link IconGlyph} under a stable `name`: `char` is the character
 * the font maps to the symbol, `fontFamily` the family {@link provideIconFont} loads. The form a plugin
 * registers via {@link provideIcons} so `<app-icon name="…">` draws a font glyph web-ui's SVG core set
 * omits, without a bespoke per-plugin component (ADR-0007).
 */
export function fontGlyph(name: string, char: string, fontFamily: string): FontGlyph {
  return { name, char, fontFamily };
}

/** An icon font to load: its `family`, the bundled font-file `source` URL, and optional `descriptors`. */
export interface IconFont {
  readonly family: string;
  readonly source: string;
  readonly descriptors?: FontFaceDescriptors;
}

/**
 * Load an icon font that {@link fontGlyph} glyphs draw with, via the CSS Font Loading API — the seam a
 * plugin uses to bring its own font (its `.otf`/`.woff`) without editing the app's global stylesheet or
 * asset list (ADR-0007). `source` is the bundled font URL: a plugin imports its file with the esbuild
 * `file` loader (`import url from './x.otf' with { loader: 'file' }`) and passes that here, so the font
 * lives next to the code that uses it. Registered once at bootstrap; a no-op where `document.fonts` is
 * absent (SSR, jsdom). `font-display: block` by default — an icon font blocks briefly rather than flash
 * the wrong fallback character.
 */
export function provideIconFont(font: IconFont): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideAppInitializer(() => {
      if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) return;
      const face = new FontFace(font.family, `url(${font.source})`, { display: 'block', ...font.descriptors });
      // `FontFaceSet.add` is part of the runtime API but absent from this TS lib's `FontFaceSet` type.
      (document.fonts as unknown as { add(font: FontFace): void }).add(face);
      void face.load();
    }),
  ]);
}

/** Runtime-contributed {@link IconGlyph}s (via {@link provideIcons}), folded into the root icon registry. */
export const ICON_GLYPHS = new InjectionToken<readonly IconGlyph[]>('hexly.icon.glyphs');

/**
 * Register {@link IconGlyph}s so `<app-icon name="…">` can draw them by name — the seam a plugin uses
 * to dress its types in glyphs web-ui's core vocabulary omits (ADR-0007). A plugin composes this
 * alongside its `providePluginX()` in `app.config.ts`. A later contribution wins its name, so a
 * plugin may override a core glyph.
 */
export function provideIcons(glyphs: readonly IconGlyph[]): EnvironmentProviders {
  return makeEnvironmentProviders(glyphs.map((glyph) => ({ provide: ICON_GLYPHS, useValue: glyph, multi: true })));
}
