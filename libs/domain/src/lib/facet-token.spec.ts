import { describe, expect, it } from 'vitest';
import { FacetKeySet, parseFacetQuery } from './facet-token';

describe('parseFacetQuery (ADR-0082)', () => {
  /** The Entity Browser's vocabulary: the reserved trio it can apply, plus two Facet keys. */
  const keys: FacetKeySet = {
    reserved: ['type', 'tag', 'visibility'],
    fields: ['challenge_rating', 'region', 'Type'],
  };

  it('leaves a box with no token entirely as full text', () => {
    const parsed = parseFacetQuery('Session 4: the ambush', keys);

    expect(parsed.text).toBe('Session 4: the ambush');
    expect(parsed.include.type).toEqual([]);
    expect(parsed.fields).toEqual([]);
    expect(parsed.unresolvedKeys).toEqual([]);
  });

  it('lifts a reserved token out of the text and leaves the rest searchable', () => {
    const parsed = parseFacetQuery('orc $tag:fantasy $type:npc', keys);

    expect(parsed.text).toBe('orc');
    expect(parsed.include.tag).toEqual(['fantasy']);
    expect(parsed.include.type).toEqual(['npc']);
  });

  it('excludes on a leading dash', () => {
    const parsed = parseFacetQuery('-$tag:draft', keys);

    expect(parsed.exclude.tag).toEqual(['draft']);
    expect(parsed.include.tag).toEqual([]);
    expect(parsed.text).toBe('');
  });

  it('ORs an unquoted comma and keeps a quoted one literal', () => {
    const parsed = parseFacetQuery('$tag:a,b $tag:"sea, of storms"', keys);

    expect(parsed.include.tag).toEqual(['a', 'b', 'sea, of storms']);
  });

  it('reads a quoted value as one value, spaces and all', () => {
    const parsed = parseFacetQuery('$tag:"sea of storms" orc', keys);

    expect(parsed.include.tag).toEqual(['sea of storms']);
    expect(parsed.text).toBe('orc');
  });

  it('parses a trailing quote left unclosed at end of input', () => {
    const parsed = parseFacetQuery('$tag:"sea of storm', keys);

    expect(parsed.include.tag).toEqual(['sea of storm']);
    expect(parsed.text).toBe('');
  });

  it('mixes quoted and bare segments in one comma list', () => {
    const parsed = parseFacetQuery('$tag:a,"b c",d', keys);

    expect(parsed.include.tag).toEqual(['a', 'b c', 'd']);
  });

  it('maps >= onto gte and <= onto lte for a Facet key', () => {
    const parsed = parseFacetQuery('$challenge_rating:>=5 $challenge_rating:<=9', keys);

    expect(parsed.fields).toEqual([
      { key: 'challenge_rating', op: 'gte', value: '5' },
      { key: 'challenge_rating', op: 'lte', value: '9' },
    ]);
  });

  it('takes both bounds from one comma list', () => {
    const parsed = parseFacetQuery('$challenge_rating:>=5,<=9', keys);

    expect(parsed.fields).toEqual([
      { key: 'challenge_rating', op: 'gte', value: '5' },
      { key: 'challenge_rating', op: 'lte', value: '9' },
    ]);
  });

  it('reads a Facet key value as eq, and its negation as neq', () => {
    const parsed = parseFacetQuery('$region:north -$region:south', keys);

    expect(parsed.fields).toEqual([
      { key: 'region', op: 'eq', value: 'north' },
      { key: 'region', op: 'neq', value: 'south' },
    ]);
  });

  it('quotes a comparison back into a literal value', () => {
    const parsed = parseFacetQuery('$region:">=5"', keys);

    expect(parsed.fields).toEqual([{ key: 'region', op: 'eq', value: '>=5' }]);
  });

  it('drops a negated bound — the wire has no such filter — and keeps the rest of the box', () => {
    const parsed = parseFacetQuery('orc -$challenge_rating:>=5', keys);

    expect(parsed.fields).toEqual([]);
    expect(parsed.text).toBe('orc');
  });

  it('recognises $ only at a word boundary', () => {
    const parsed = parseFacetQuery('cost$tag:fantasy a-$type:npc', keys);

    expect(parsed.include.tag).toEqual([]);
    expect(parsed.include.type).toEqual([]);
    expect(parsed.text).toBe('cost$tag:fantasy a-$type:npc');
  });

  it('leaves a $ with no colon as text — the name is still being typed', () => {
    const parsed = parseFacetQuery('$tag orc', keys);

    expect(parsed.text).toBe('$tag orc');
    expect(parsed.unresolvedKeys).toEqual([]);
  });

  it('reports an unresolvable key rather than searching for it', () => {
    const parsed = parseFacetQuery('orc $domain:material', keys);

    expect(parsed.unresolvedKeys).toEqual(['domain']);
    expect(parsed.text).toBe('orc');
  });

  it('reports an unresolvable key once, however often it is named', () => {
    const parsed = parseFacetQuery('$domain:a $domain:b', keys);

    expect(parsed.unresolvedKeys).toEqual(['domain']);
  });

  it('reports a reserved name the surface does not offer', () => {
    const parsed = parseFacetQuery('$in:pack-1', keys);

    expect(parsed.unresolvedKeys).toEqual(['in']);
    expect(parsed.include.container).toEqual([]);
  });

  it('offers the Container to a surface whose key set names it', () => {
    const parsed = parseFacetQuery('$in:pack-1', { reserved: ['in'], fields: [] });

    expect(parsed.include.container).toEqual(['pack-1']);
    expect(parsed.unresolvedKeys).toEqual([]);
  });

  it('lets a reserved name win over a same-named Facet key, which keeps its full key', () => {
    const parsed = parseFacetQuery('$type:npc $core.field.type:npc', {
      reserved: ['type'],
      fields: ['type', 'core.field.type'],
    });

    expect(parsed.include.type).toEqual(['npc']);
    expect(parsed.fields).toEqual([{ key: 'core.field.type', op: 'eq', value: 'npc' }]);
  });

  it('matches values exactly, including case', () => {
    const parsed = parseFacetQuery('$tag:Fantasy', keys);

    expect(parsed.include.tag).toEqual(['Fantasy']);
  });

  it('matches keys exactly, so a miscased name is a reported miss', () => {
    const parsed = parseFacetQuery('$Tag:fantasy', keys);

    expect(parsed.unresolvedKeys).toEqual(['Tag']);
    expect(parsed.include.tag).toEqual([]);
  });

  it('applies a token with an empty value as nothing at all, and never as text', () => {
    const parsed = parseFacetQuery('orc $tag:', keys);

    expect(parsed.include.tag).toEqual([]);
    expect(parsed.text).toBe('orc');
  });

  it('lets an exclusion veto an inclusion of the same value (ADR-0081)', () => {
    const parsed = parseFacetQuery('$tag:draft -$tag:draft $region:north -$region:north', keys);

    expect(parsed.include.tag).toEqual([]);
    expect(parsed.exclude.tag).toEqual(['draft']);
    expect(parsed.fields).toEqual([{ key: 'region', op: 'neq', value: 'north' }]);
  });

  it('says the same value twice only once', () => {
    const parsed = parseFacetQuery('$tag:a $tag:a $region:north $region:north', keys);

    expect(parsed.include.tag).toEqual(['a']);
    expect(parsed.fields).toEqual([{ key: 'region', op: 'eq', value: 'north' }]);
  });

  it('collapses the whitespace a stripped token leaves behind', () => {
    const parsed = parseFacetQuery('  orc $tag:a  hero  ', keys);

    expect(parsed.text).toBe('orc hero');
  });

  it('takes no key set as no Facet key at all — every $ name is a reported miss', () => {
    const parsed = parseFacetQuery('$region:north', { reserved: [], fields: [] });

    expect(parsed.unresolvedKeys).toEqual(['region']);
    expect(parsed.fields).toEqual([]);
  });

  it('offers every reserved name when the key set names none', () => {
    const parsed = parseFacetQuery('$type:npc $in:pack-1', { fields: [] });

    expect(parsed.include.type).toEqual(['npc']);
    expect(parsed.include.container).toEqual(['pack-1']);
  });
});
