/** The prefix and residual query the Palette routes to Providers (ADR-0032). */
export interface ParsedQuery {
  readonly prefix: string;
  readonly query: string;
}

/**
 * Split the typed text into a routing prefix and the query the matching Providers
 * see. Only the empty prefix (Quick Open) and `>` (Show Commands) exist in v1;
 * everything else is plain Quick Open text. The space after `>` is cosmetic, so
 * "> create" and ">create" both search "create".
 */
export function parseQuery(text: string): ParsedQuery {
  if (text.startsWith('>')) return { prefix: '>', query: text.slice(1).trimStart() };
  return { prefix: '', query: text };
}
