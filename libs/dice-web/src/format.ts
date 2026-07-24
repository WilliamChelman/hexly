import { RollResult } from './dice';

/** A Roll rendered for display: the total to headline, and the working that produced it. */
export interface FormattedRoll {
  /** The grand total — the value that pops. */
  readonly total: string;
  /** The expression and per-die breakdown behind the total. */
  readonly detail: string;
}

/**
 * Render a Roll Result for the toaster: the total as a standalone headline, the expression and its
 * per-die breakdown as the detail beneath it. Locale-neutral — numbers and the expression the user
 * typed carry no translatable copy (CONTEXT.md — Dice). Dropped dice are parenthesised; a term-free
 * (pure-arithmetic) expression has no breakdown, so the detail is just the expression.
 */
export function formatRoll(expression: string, result: RollResult): FormattedRoll {
  const breakdown = result.terms
    .map((term) => {
      const faces = term.dice.map((die) => (die.dropped ? `(${die.value})` : `${die.value}`)).join(', ');
      return `${term.count}d${term.sides}: ${faces}`;
    })
    .join('; ');
  return {
    total: `${result.total}`,
    detail: `${expression}${breakdown ? ` → ${breakdown}` : ''}`,
  };
}
