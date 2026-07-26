// `export type` on the type-only names: the Angular builds that now consume this barrel compile under
// `isolatedModules`, where a re-exported type has to say so.
export type { DesignToken, DesignTokenDecl, PublicDesignToken } from './tokens/manifest';
export { DESIGN_TOKENS, designToken, isDesignToken } from './tokens/manifest';
export type { Tier, TokenDecl, TokenType } from './tokens/design-token';
export { designTokenPropertyBlock, registeredTokens } from './tokens/property-block';
export { designTokenInitial, readDesignToken } from './tokens/read-token';
