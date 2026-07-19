import { RollResult } from './dice';
import { formatRoll } from './format';

describe('formatRoll', () => {
  it("shows each dice term's faces alongside the total", () => {
    const result: RollResult = {
      total: 14,
      terms: [
        {
          type: 'dice',
          count: 2,
          sides: 10,
          subtotal: 11,
          dice: [
            { faces: [7], value: 7, dropped: false },
            { faces: [4], value: 4, dropped: false },
          ],
        },
      ],
    };
    expect(formatRoll('2d10 + 3', result)).toBe('2d10 + 3 → 2d10: 7, 4 = 14');
  });

  it('parenthesises dropped dice so a keep/drop is legible', () => {
    const result: RollResult = {
      total: 15,
      terms: [
        {
          type: 'dice',
          count: 3,
          sides: 6,
          subtotal: 15,
          dice: [
            { faces: [6], value: 6, dropped: false },
            { faces: [2], value: 2, dropped: true },
            { faces: [9], value: 9, dropped: false },
          ],
        },
      ],
    };
    expect(formatRoll('3d6kh2', result)).toBe('3d6kh2 → 3d6: 6, (2), 9 = 15');
  });

  it('joins multiple dice terms in source order', () => {
    const result: RollResult = {
      total: 12,
      terms: [
        {
          type: 'dice',
          count: 1,
          sides: 20,
          subtotal: 8,
          dice: [{ faces: [8], value: 8, dropped: false }],
        },
        {
          type: 'dice',
          count: 1,
          sides: 4,
          subtotal: 4,
          dice: [{ faces: [4], value: 4, dropped: false }],
        },
      ],
    };
    expect(formatRoll('d20 + d4', result)).toBe('d20 + d4 → 1d20: 8; 1d4: 4 = 12');
  });

  it('drops the breakdown for a term-free arithmetic expression', () => {
    const result: RollResult = { total: 5, terms: [] };
    expect(formatRoll('2 + 3', result)).toBe('2 + 3 = 5');
  });
});
