import { parseCommandQuery } from './command';

describe('parseCommandQuery', () => {
  // The prefixes a running palette would report: Quick Open, Show Commands, Roll,
  // plus a hypothetical longer `/rr ` to prove longest-wins against the `/r ` it contains.
  const prefixes = ['', '>', '/r ', '/rr '];

  it('routes plain text to the empty (Quick Open) prefix', () => {
    expect(parseCommandQuery('aldermoor', prefixes)).toEqual({
      prefix: '',
      query: 'aldermoor',
    });
  });

  it('routes text led by > to the Show Commands prefix, minus the marker', () => {
    expect(parseCommandQuery('>create note', prefixes)).toEqual({
      prefix: '>',
      query: 'create note',
    });
  });

  it('treats a bare > as the Show Commands prefix with an empty query', () => {
    expect(parseCommandQuery('>', prefixes)).toEqual({ prefix: '>', query: '' });
  });

  it('routes a /r query to the Roll prefix, minus the marker', () => {
    expect(parseCommandQuery('/r 2d10 + 3', prefixes)).toEqual({
      prefix: '/r ',
      query: '2d10 + 3',
    });
  });

  it('routes to the longest registered prefix a query starts with', () => {
    // `/rr 2d6` starts with both `/r ` (no) and `/rr ` — the longer wins.
    expect(parseCommandQuery('/rr 2d6', prefixes)).toEqual({
      prefix: '/rr ',
      query: '2d6',
    });
  });

  it('falls back to empty when a query matches no registered prefix', () => {
    // Only `''` and `>` registered: a `/r …` query has no home but Quick Open.
    expect(parseCommandQuery('/r 2d10', ['', '>'])).toEqual({
      prefix: '',
      query: '/r 2d10',
    });
  });

  it('falls back to empty even when empty is not among the registered prefixes', () => {
    expect(parseCommandQuery('aldermoor', ['>'])).toEqual({
      prefix: '',
      query: 'aldermoor',
    });
  });
});
