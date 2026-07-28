// `export type` because the manifest now reaches Angular-compiled consumers — directly, and through
// `@hexly/domain` once the World Theme schema is generated from it (ADR-0076). Those builds run under
// `isolatedModules`, where a re-exported type has to say so.
export type { DesignToken, DesignTokenDecl, PublicDesignToken } from './tokens/manifest';
export { DESIGN_TOKENS, SETTABLE_TOKENS, designToken, isDesignToken, isSettableToken } from './tokens/manifest';
export type { Tier, TokenDecl, TokenType } from './tokens/design-token';
export { designTokenPropertyBlock, registeredTokens } from './tokens/property-block';
// The fenced-region plumbing, so `libs/domain`'s Palette Preset generator splices the same way this
// one does rather than restating it (ADR-0077).
export type { FencedRegion } from './tokens/property-block';
export { GENERATE_COMMAND, fencedRegionIn, withFencedRegion } from './tokens/property-block';
export { designTokenInitial, designTokenStyle, readDesignToken } from './tokens/read-token';
export type { DeclaredTokens, TokenDerivation } from './tokens/declared';
export { declaredTokenValues, tokenDerivation } from './tokens/declared';
// The judging (`themeWarnings`, `contrastRatio`, `deltaE00`, the thresholds) stays inside
// `./contrast`, where its own spec reaches it: `contrastReport` is the whole face of it (ADR-0076).
// Its two halves are exported beside it for the one caller that cannot take the whole — the Preset
// contrast gate, which holds the engine behind `page.evaluate` and can only await it (ADR-0077).
export type { ThemeWarning } from './contrast/contrast';
export type {
  ColorRasterisation,
  ContrastRasterisations,
  ContrastRasterised,
  RasterisedColor,
} from './contrast/measure';
export {
  CONTRAST_REPORT_TOKENS,
  contrastRasterisations,
  contrastReport,
  contrastVerdict,
  measureScheme,
  rasteriseColors,
} from './contrast/measure';
