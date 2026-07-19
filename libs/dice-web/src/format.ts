import { RollResult } from './dice';

/**
 * Render a Roll Result as one toaster line. Locale-neutral — numbers and the expression the user
 * typed carry no translatable copy (CONTEXT.md — Dice). Dropped dice are parenthesised; a term-free
 * (pure-arithmetic) expression drops the breakdown, leaving `expression = total`.
 */
export function formatRoll(expression: string, result: RollResult): string {
  const breakdown = result.terms
    .map((term) => {
      const faces = term.dice.map((die) => (die.dropped ? `(${die.value})` : `${die.value}`)).join(', ');
      return `${term.count}d${term.sides}: ${faces}`;
    })
    .join('; ');
  return `${expression}${breakdown ? ` → ${breakdown}` : ''} = ${result.total}`;
}
