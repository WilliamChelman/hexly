import { DiceErrorCode } from './dice';
import { parse } from './parse';

/** The typed error code for an expression `parse` should reject. */
function errorCode(expression: string): DiceErrorCode | 'unexpectedly-ok' {
  const result = parse(expression);
  return result.isErr() ? result.error.code : 'unexpectedly-ok';
}

describe('parse', () => {
  it('accepts a bare NdM term', () => {
    const result = parse('2d6');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toEqual({ type: 'dice', count: 2, sides: 6, modifiers: [] });
  });

  it('accepts an implicit single die (dM)', () => {
    const result = parse('d20');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toMatchObject({ type: 'dice', count: 1, sides: 20 });
  });

  it('never throws — invalid input comes back as a typed error, not an exception', () => {
    expect(() => parse('%%%')).not.toThrow();
    expect(parse('%%%').isErr()).toBe(true);
  });

  it('reports an empty expression', () => {
    expect(errorCode('')).toBe('empty');
    expect(errorCode('   ')).toBe('empty');
  });

  it('reports a syntax error for junk input', () => {
    expect(errorCode('abc')).toBe('syntax');
    expect(errorCode('2d6 +')).toBe('syntax');
  });

  it('reports unbalanced parentheses', () => {
    expect(errorCode('(2 + 3')).toBe('unbalanced-parens');
  });

  it('reports a die with no sides as invalid dice', () => {
    expect(errorCode('1d0')).toBe('invalid-dice');
  });

  it('reports trailing input the grammar cannot place', () => {
    expect(errorCode('2d6 6')).toBe('trailing-input');
  });
});
