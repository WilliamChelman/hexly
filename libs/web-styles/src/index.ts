// `export type` because the manifest now reaches Angular-compiled consumers — directly, and through
// `@hexly/domain` once the World Theme schema is generated from it (ADR-0076). Those builds run under
// `isolatedModules`, where a re-exported type has to say so.
export type { DesignToken, DesignTokenDecl, PublicDesignToken } from './tokens/manifest';
export { DESIGN_TOKENS, designToken, isDesignToken } from './tokens/manifest';
export type { Tier, TokenDecl, TokenType } from './tokens/design-token';
export { designTokenPropertyBlock, registeredTokens } from './tokens/property-block';
export { designTokenInitial, readDesignToken } from './tokens/read-token';
