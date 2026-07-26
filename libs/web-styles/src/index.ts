export type { DesignToken, DesignTokenDecl, PublicDesignToken } from './tokens/manifest';
export { DESIGN_TOKENS, designToken, isDesignToken } from './tokens/manifest';
// `export type` because the manifest now reaches an Angular-compiled consumer through `@hexly/domain`
// (the World Theme schema is generated from it, ADR-0076), and that build runs under `isolatedModules`.
export type { Tier, TokenDecl, TokenType } from './tokens/design-token';
export { designTokenPropertyBlock, registeredTokens } from './tokens/property-block';
