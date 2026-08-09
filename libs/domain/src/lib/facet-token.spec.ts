import { describe, expect, it } from 'vitest';
import { FacetKeySet, parseFacetQuery, removeFacetToken } from './facet-token';

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

  it('holds a value whose quote is still open, and says so rather than filtering half of it', () => {
    const parsed = parseFacetQuery('$tag:"sea of storm', keys);

    expect(parsed.include.tag).toEqual([]);
    expect(parsed.text).toBe('');
    expect(parsed.inapplicableTokens).toEqual([{ key: 'tag', reason: 'unterminated-quote' }]);
  });

  it('applies the closed values of a list while its last quote is still open', () => {
    const parsed = parseFacetQuery('$tag:a,"sea of storm', keys);

    expect(parsed.include.tag).toEqual(['a']);
    expect(parsed.inapplicableTokens).toEqual([]);
  });

  it('starts a new token at a $ after a comma, rather than reading one as a value', () => {
    const parsed = parseFacetQuery('$tag:a,$tag:b orc', keys);

    expect(parsed.include.tag).toEqual(['a', 'b']);
    expect(parsed.text).toBe('orc');
  });

  it('starts a negated token at a $ after a comma', () => {
    const parsed = parseFacetQuery('$tag:a,-$type:npc', keys);

    expect(parsed.include.tag).toEqual(['a']);
    expect(parsed.exclude.type).toEqual(['npc']);
    expect(parsed.text).toBe('');
  });

  it('keeps a quoted $ as the value it says', () => {
    const parsed = parseFacetQuery('$tag:a,"$tag:b"', keys);

    expect(parsed.include.tag).toEqual(['a', '$tag:b']);
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

  it('maps a bare > onto gt and a bare < onto lt', () => {
    const parsed = parseFacetQuery('$challenge_rating:>5 $region:<m', keys);

    expect(parsed.fields).toEqual([
      { key: 'challenge_rating', op: 'gt', value: '5' },
      { key: 'region', op: 'lt', value: 'm' },
    ]);
    expect(parsed.inapplicableTokens).toEqual([]);
  });

  it('reads a written = as the membership a bare value writes, and its negation as neq', () => {
    const parsed = parseFacetQuery('$challenge_rating:=5 -$region:=north', keys);

    expect(parsed.fields).toEqual([
      { key: 'challenge_rating', op: 'eq', value: '5' },
      { key: 'region', op: 'neq', value: 'north' },
    ]);
  });

  it('reports a comparison written with nothing to compare to', () => {
    const parsed = parseFacetQuery('$challenge_rating:>=', keys);

    expect(parsed.fields).toEqual([]);
    expect(parsed.inapplicableTokens).toEqual([{ key: 'challenge_rating', reason: 'empty-value' }]);
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

  it('reports a negated bound — the wire has no such filter — and keeps the rest of the box', () => {
    const parsed = parseFacetQuery('orc -$challenge_rating:>=5', keys);

    expect(parsed.fields).toEqual([]);
    expect(parsed.text).toBe('orc');
    expect(parsed.inapplicableTokens).toEqual([{ key: 'challenge_rating', reason: 'negated-bound' }]);
  });

  it('reports a negated bound even when a sibling value in the same token applies', () => {
    const parsed = parseFacetQuery('-$challenge_rating:>=5,3', keys);

    expect(parsed.fields).toEqual([{ key: 'challenge_rating', op: 'neq', value: '3' }]);
    expect(parsed.inapplicableTokens).toEqual([{ key: 'challenge_rating', reason: 'negated-bound' }]);
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

  it('reports a token with an empty value rather than browsing as if the box were empty', () => {
    const parsed = parseFacetQuery('orc $tag:', keys);

    expect(parsed.include.tag).toEqual([]);
    expect(parsed.text).toBe('orc');
    expect(parsed.inapplicableTokens).toEqual([{ key: 'tag', reason: 'empty-value' }]);
  });

  it('reports one miss per key and reason, however often it is written', () => {
    const parsed = parseFacetQuery('$tag: $tag: -$challenge_rating:>=5 $tag:"open', keys);

    expect(parsed.inapplicableTokens).toEqual([
      { key: 'tag', reason: 'empty-value' },
      { key: 'challenge_rating', reason: 'negated-bound' },
      { key: 'tag', reason: 'unterminated-quote' },
    ]);
  });

  it('reports nothing for a token that applied a filter, whatever else it wrote', () => {
    const parsed = parseFacetQuery('$tag:a, $tag:b', keys);

    expect(parsed.include.tag).toEqual(['a', 'b']);
    expect(parsed.inapplicableTokens).toEqual([]);
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

describe('removeFacetToken (ADR-0082)', () => {
  const keys: FacetKeySet = {
    reserved: ['type', 'tag', 'visibility'],
    fields: ['challenge_rating', 'region'],
  };

  it('takes the token naming a value out, leaving every other word as typed', () => {
    expect(
      removeFacetToken('orc $tag:fantasy Session 4: the ambush', keys, { category: 'tag', value: 'fantasy' }),
    ).toBe('orc Session 4: the ambush');
  });

  it('leaves a second token naming another value of the same Facet alone', () => {
    expect(removeFacetToken('$tag:draft $tag:fantasy', keys, { category: 'tag', value: 'draft' })).toBe('$tag:fantasy');
  });

  it('takes an exclusion out, its leading dash with it', () => {
    expect(removeFacetToken('-$tag:draft orc', keys, { category: 'tag', value: 'draft' })).toBe('orc');
  });

  it('takes a value out of a comma list and leaves the list', () => {
    expect(removeFacetToken('$tag:a,b,c', keys, { category: 'tag', value: 'b' })).toBe('$tag:a,c');
    expect(removeFacetToken('$tag:a,b,c', keys, { category: 'tag', value: 'a' })).toBe('$tag:b,c');
    expect(removeFacetToken('$tag:a,b,c', keys, { category: 'tag', value: 'c' })).toBe('$tag:a,b');
  });

  it('takes a quoted value out by what it says, quotes and all', () => {
    expect(removeFacetToken('$tag:"sea of storms",b orc', keys, { category: 'tag', value: 'sea of storms' })).toBe(
      '$tag:b orc',
    );
  });

  it('empties a box that held nothing else', () => {
    expect(removeFacetToken('$tag:draft', keys, { category: 'tag', value: 'draft' })).toBe('');
  });

  it('takes out both polarities of one value, so one click leaves nothing behind', () => {
    expect(removeFacetToken('$tag:draft -$tag:draft', keys, { category: 'tag', value: 'draft' })).toBe('');
  });

  it('addresses the Container by the name it is typed with, on a surface that offers it', () => {
    expect(removeFacetToken('orc $in:pack-1', { fields: [] }, { category: 'container', value: 'pack-1' })).toBe('orc');
  });

  it('takes out a Facet key’s value, matched on its key', () => {
    expect(removeFacetToken('$region:north $tag:north', keys, { field: 'region', value: 'north' })).toBe('$tag:north');
  });

  it('never mistakes a bound for a value', () => {
    expect(
      removeFacetToken('$challenge_rating:>=5 $challenge_rating:5', keys, { field: 'challenge_rating', value: '5' }),
    ).toBe('$challenge_rating:>=5');
    expect(removeFacetToken('$challenge_rating:>5', keys, { field: 'challenge_rating', value: '5' })).toBe(
      '$challenge_rating:>5',
    );
  });

  it('takes out the bound an `op` names, leaving the membership token beside it', () => {
    expect(
      removeFacetToken('$challenge_rating:>=5 $challenge_rating:5', keys, {
        field: 'challenge_rating',
        op: 'gte',
        value: '5',
      }),
    ).toBe('$challenge_rating:5');
  });

  it('takes out a bound by the comparison it was written with, never its twin', () => {
    const target = { field: 'challenge_rating', op: 'gt' as const, value: '5' };
    expect(removeFacetToken('orc $challenge_rating:>5', keys, target)).toBe('orc');
    // `>=5` is a different bound: it applies a different filter, so it is not the token asked for.
    expect(removeFacetToken('$challenge_rating:>=5', keys, target)).toBe('$challenge_rating:>=5');
  });

  it('never takes a quoted value for a bound — it was read as a value, and is removed as one', () => {
    expect(
      removeFacetToken('$challenge_rating:">=5"', keys, { field: 'challenge_rating', op: 'gte', value: '5' }),
    ).toBe('$challenge_rating:">=5"');
    expect(removeFacetToken('$challenge_rating:">=5"', keys, { field: 'challenge_rating', value: '>=5' })).toBe('');
  });

  it('takes out a value written with its = , which is how it was applied', () => {
    expect(removeFacetToken('orc $challenge_rating:=5', keys, { field: 'challenge_rating', value: '5' })).toBe('orc');
  });

  it('takes out a token that opened at a comma, the comma with it', () => {
    expect(removeFacetToken('$tag:a,$tag:b orc', keys, { category: 'tag', value: 'b' })).toBe('$tag:a orc');
    expect(removeFacetToken('$tag:a,$tag:b', keys, { category: 'tag', value: 'a' })).toBe('$tag:b');
  });

  it('leaves prose that merely spells the value where it is', () => {
    expect(removeFacetToken('fantasy $tag:fantasy', keys, { category: 'tag', value: 'fantasy' })).toBe('fantasy');
  });

  it('matches a value exactly, case included', () => {
    expect(removeFacetToken('$tag:Draft', keys, { category: 'tag', value: 'draft' })).toBe('$tag:Draft');
  });

  it('leaves a box that never named the value untouched', () => {
    expect(removeFacetToken('orc  hero', keys, { category: 'tag', value: 'draft' })).toBe('orc  hero');
  });

  it('takes one separating space with the token, and no more of the caller’s spacing', () => {
    expect(removeFacetToken('orc  $tag:a  hero', keys, { category: 'tag', value: 'a' })).toBe('orc  hero');
  });

  it('leaves a key this surface does not answer to alone', () => {
    expect(removeFacetToken('$region:north', { reserved: [], fields: [] }, { field: 'region', value: 'north' })).toBe(
      '$region:north',
    );
  });
});
