/**
 * Ambient type for a font imported with the esbuild `file` loader
 * (`import url from './x.otf' with { loader: 'file' }`) — the default export is the
 * emitted asset's runtime URL. Lets the plugin bundle its glyph font next to the code
 * that loads it, with no app-level asset wiring (ADR-0007).
 */
declare module '*.otf' {
  const url: string;
  export default url;
}
