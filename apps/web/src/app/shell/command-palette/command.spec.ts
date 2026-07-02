import { parseCommandQuery } from './command';

describe('parseCommandQuery', () => {
  it('routes plain text to the empty (Quick Open) prefix', () => {
    expect(parseCommandQuery('aldermoor')).toEqual({
      prefix: '',
      query: 'aldermoor',
    });
  });

  it('routes text led by > to the Show Commands prefix, minus the marker', () => {
    expect(parseCommandQuery('>create note')).toEqual({
      prefix: '>',
      query: 'create note',
    });
  });

  it('treats a bare > as the Show Commands prefix with an empty query', () => {
    expect(parseCommandQuery('>')).toEqual({ prefix: '>', query: '' });
  });
});
