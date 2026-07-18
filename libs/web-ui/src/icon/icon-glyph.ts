import { EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';
import type { LucideIconData } from '@lucide/angular';

/**
 * One glyph as the icon primitives draw it (ADR-0007): the `<svg>` inner `body` markup plus the
 * root `attrs` that vary per glyph, keyed by a stable `name`. Both the app's bespoke glyphs and
 * Lucide's normalise to this shape — {@link lucideGlyph} converts Lucide's node data into it — so
 * the `<app-icon>` dispatcher and the registry it reads speak one representation.
 */
export interface IconGlyph {
  readonly name: string;
  readonly attrs: string;
  readonly body: string;
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
export function lucideGlyph(name: string, source: { readonly icon: LucideIconData }): IconGlyph {
  return { name, attrs: LUCIDE_ATTRS, body: lucideBody(source.icon) };
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
