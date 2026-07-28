/** The shape of one design-token declaration (ADR-0075, "A manifest is the single source of the contract"). */

/**
 * Which of ADR-0075's three tiers a token belongs to. The boundary is *what a token means*, not who
 * uses it.
 */
export type Tier = 'palette' | 'role' | 'plugin';

/**
 * What kind of value a token holds — it picks the `@property` syntax, the theme editor's control, and
 * the write choke point's validator. `font-pairing` is a token the chosen pairing writes (spec §5.4).
 */
export type TokenType = 'color' | 'number' | 'length' | 'time' | 'easing' | 'shadow' | 'gradient' | 'font-pairing';

export interface TokenDecl {
  readonly name: `--${string}`;
  readonly tier: Tier;
  readonly type: TokenType;
  /** In the World Theme contract — so renaming or removing it is a migration against stored themes. */
  readonly public: boolean;
  /** The owning plugin's id, for tier 3. */
  readonly owner?: string;
  /**
   * The token's value in the Solar ColorScheme, and the `@property` `initial-value` when registered —
   * so for a tier-2 role it is what the derivation *resolves to*, never the expression itself: an
   * `initial-value` must be computationally independent, which a `var(--palette-…)` is not.
   */
  readonly initial: string;
  /**
   * Opt out of `@property` registration: a registered property computes at the element that *declares*
   * it, so a font-relative length would stop scaling with the element that uses it. For a relative
   * length the opt-out is forced rather than chosen — an `initial-value` must be computationally
   * independent, and a rule carrying one that isn't is dropped whole, leaving the token unregistered
   * anyway but claiming otherwise.
   */
  readonly unregistered?: true;
}
