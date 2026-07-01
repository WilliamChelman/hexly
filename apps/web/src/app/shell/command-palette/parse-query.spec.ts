import { parseQuery } from './parse-query';

describe('parseQuery', () => {
  it('routes plain text to the empty (Quick Open) prefix', () => {
    expect(parseQuery('aldermoor')).toEqual({ prefix: '', query: 'aldermoor' });
  });

  it('routes a leading > to the Show Commands prefix, stripping it', () => {
    expect(parseQuery('>create')).toEqual({ prefix: '>', query: 'create' });
  });

  it('trims the space after the > prefix so ">  create" still matches "create"', () => {
    expect(parseQuery('> create note')).toEqual({
      prefix: '>',
      query: 'create note',
    });
  });
});
