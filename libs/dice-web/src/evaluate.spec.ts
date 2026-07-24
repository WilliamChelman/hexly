import { TestBed } from '@angular/core/testing';

import { DICE_RNG, Rng, RollResult } from './dice';
import { CHAIN_LIMIT, evaluate } from './evaluate';
import { parse } from './parse';

/**
 * A float that maps to `n` on a `d(sides)` — `floor(((n - 0.5) / sides) * sides) + 1 === n`.
 * Lets a scripted RNG name the faces it wants a Roll to produce.
 */
const face = (n: number, sides: number): number => (n - 0.5) / sides;

/** An RNG that replays `values` in order — the seeded source the engine draws from. */
const scripted = (values: readonly number[]): Rng => {
  let cursor = 0;
  return () => values[cursor++];
};

/** Parse then evaluate — asserts the end-to-end external behaviour of an expression. */
function roll(expression: string, rng: Rng): RollResult {
  const result = parse(expression);
  if (result.isErr()) throw new Error(`expected "${expression}" to parse: ${result.error.message}`);
  return evaluate(result.value, rng);
}

describe('evaluate', () => {
  it('rolls an NdM term, exposing per-die faces and the term subtotal', () => {
    const result = roll('2d6', scripted([face(3, 6), face(5, 6)]));
    expect(result.terms).toEqual([
      {
        type: 'dice',
        count: 2,
        sides: 6,
        subtotal: 8,
        dice: [
          { faces: [3], value: 3, dropped: false },
          { faces: [5], value: 5, dropped: false },
        ],
      },
    ]);
    expect(result.total).toBe(8);
  });

  it('applies + - * / with standard precedence', () => {
    // 3 * 4 binds before + — arithmetic carries no dice terms.
    const result = roll('2 + 3 * 4', scripted([]));
    expect(result.total).toBe(14);
    expect(result.terms).toEqual([]);
  });

  it('lets parentheses override precedence', () => {
    expect(roll('(2 + 3) * 4', scripted([])).total).toBe(20);
  });

  it('floors division to a whole number', () => {
    expect(roll('7 / 2', scripted([])).total).toBe(3);
    expect(roll('10 / 3', scripted([])).total).toBe(3);
  });

  it('subtracts a flat modifier from a dice term', () => {
    const result = roll('2d6 - 3', scripted([face(4, 6), face(4, 6)]));
    expect(result.terms[0].subtotal).toBe(8);
    expect(result.total).toBe(5);
  });

  it('keeps the highest dice (kh) and marks the rest dropped', () => {
    const result = roll('4d6kh3', scripted([face(1, 6), face(2, 6), face(3, 6), face(4, 6)]));
    const term = result.terms[0];
    expect(term.dice.map((d) => d.dropped)).toEqual([true, false, false, false]);
    expect(term.subtotal).toBe(9);
    expect(result.total).toBe(9);
  });

  it('drops the lowest die (dl)', () => {
    const result = roll('4d6dl1', scripted([face(1, 6), face(6, 6), face(3, 6), face(4, 6)]));
    const term = result.terms[0];
    expect(term.dice.map((d) => d.dropped)).toEqual([true, false, false, false]);
    expect(term.subtotal).toBe(13);
  });

  it('supports keep-lowest (kl) and drop-highest (dh)', () => {
    const rolls = [face(2, 6), face(5, 6), face(3, 6)];
    expect(roll('3d6kl1', scripted(rolls)).total).toBe(2);
    expect(roll('3d6dh1', scripted(rolls)).total).toBe(5);
  });

  it('explodes a die on its max face, summing the chain into one die value', () => {
    const result = roll('1d6!', scripted([face(6, 6), face(6, 6), face(3, 6)]));
    const die = result.terms[0].dice[0];
    expect(die.faces).toEqual([6, 6, 3]);
    expect(die.value).toBe(15);
    expect(result.total).toBe(15);
  });

  it('bounds explosion so an all-max RNG never runs away', () => {
    // Every roll on a d6 is a 6, so the chain only stops at the depth guard.
    const result = roll('1d6!', scripted(Array(CHAIN_LIMIT + 5).fill(face(6, 6))));
    expect(result.terms[0].dice[0].faces).toHaveLength(CHAIN_LIMIT + 1);
  });

  it('rerolls dice that match the comparator, recording the discarded face', () => {
    const result = roll('2d6r<2', scripted([face(1, 6), face(4, 6), face(5, 6)]));
    const [first, second] = result.terms[0].dice;
    expect(first.faces).toEqual([1, 4]);
    expect(first.value).toBe(4);
    expect(second.faces).toEqual([5]);
    expect(result.total).toBe(9);
  });

  it('bounds reroll so an always-matching RNG never runs away', () => {
    // r<6 on a d6 that always rolls 1 would loop without the guard.
    const result = roll('1d6r<6', scripted(Array(CHAIN_LIMIT + 5).fill(face(1, 6))));
    expect(result.terms[0].dice[0].faces).toHaveLength(CHAIN_LIMIT + 1);
  });

  it('is whitespace-tolerant: "2d10+3" equals "2d10 + 3" under the same RNG', () => {
    const tight = roll('2d10+3', scripted([face(7, 10), face(2, 10)]));
    const spaced = roll('2d10 + 3', scripted([face(7, 10), face(2, 10)]));
    expect(spaced).toEqual(tight);
    expect(tight.total).toBe(12);
  });

  it('reports each dice term separately when several are combined', () => {
    const result = roll('2d6 + 1d8', scripted([face(4, 6), face(2, 6), face(7, 8)]));
    expect(result.terms.map((t) => t.subtotal)).toEqual([6, 7]);
    expect(result.total).toBe(13);
  });
});

describe('DICE_RNG', () => {
  it('defaults to Math.random', () => {
    expect(TestBed.inject(DICE_RNG)).toBe(Math.random);
  });

  it('is overridable by callers', () => {
    const stub: Rng = () => 0.5;
    TestBed.configureTestingModule({ providers: [{ provide: DICE_RNG, useValue: stub }] });
    expect(TestBed.inject(DICE_RNG)).toBe(stub);
  });
});
