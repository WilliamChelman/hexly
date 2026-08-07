import { describe, expect, it } from 'vitest';
import { EntityFacets } from './entity';
import { FacetKeySet } from './facet-token';
import {
  applyFacetSuggestion,
  facetKeySuggestions,
  facetSuggestAt,
  facetValueSuggestions,
  facetValuesFor,
  resolvesFacetKey,
} from './facet-suggest';

describe('facetSuggestAt (ADR-0082)', () => {
  it('opens the key stage on a `$` typed at a word boundary', () => {
    expect(facetSuggestAt('$', 1)).toEqual({ stage: 'key', prefix: '', start: 1, end: 1 });
    expect(facetSuggestAt('orc $', 5)).toEqual({ stage: 'key', prefix: '', start: 5, end: 5 });
  });

  it('carries what has been typed of the key so far', () => {
    expect(facetSuggestAt('orc $ta', 7)).toEqual({ stage: 'key', prefix: 'ta', start: 5, end: 7 });
  });

  it('opens the key stage on a negated token too', () => {
    expect(facetSuggestAt('-$ta', 4)).toEqual({ stage: 'key', prefix: 'ta', start: 2, end: 4 });
  });

  it('offers nothing for a `$` mid-word — only a word boundary starts a token', () => {
    expect(facetSuggestAt('a$ta', 4)).toBeNull();
    expect(facetSuggestAt('sea$', 4)).toBeNull();
  });

  it('offers nothing where the caret stands in plain text', () => {
    expect(facetSuggestAt('orc chieftain', 13)).toBeNull();
    expect(facetSuggestAt('', 0)).toBeNull();
  });

  it('moves to the value stage once the key has its colon', () => {
    expect(facetSuggestAt('$type:', 6)).toEqual({ stage: 'value', key: 'type', prefix: '', start: 6, end: 6 });
    expect(facetSuggestAt('$type:np', 8)).toEqual({ stage: 'value', key: 'type', prefix: 'np', start: 6, end: 8 });
  });

  it('suggests the segment after an unquoted comma, the earlier values standing', () => {
    expect(facetSuggestAt('$tag:a,dr', 9)).toEqual({ stage: 'value', key: 'tag', prefix: 'dr', start: 7, end: 9 });
  });

  /** The parser starts a token at a `$` after a comma, and so must the list. */
  it('offers keys where a `$` follows a comma, not the values of the key before it', () => {
    expect(facetSuggestAt('$tag:a,$ty', 10)).toEqual({ stage: 'key', prefix: 'ty', start: 8, end: 10 });
    expect(facetSuggestAt('$tag:a,-$ty', 11)).toEqual({ stage: 'key', prefix: 'ty', start: 9, end: 11 });
  });

  it('reads an unclosed quote as a value still being typed, spaces and all', () => {
    expect(facetSuggestAt('$tag:"sea of ', 13)).toEqual({
      stage: 'value',
      key: 'tag',
      prefix: 'sea of ',
      start: 5,
      end: 13,
    });
  });

  it('closes with the token: a space after a finished value is plain text again', () => {
    expect(facetSuggestAt('$type:npc orc', 13)).toBeNull();
    expect(facetSuggestAt('$tag:"sea of storms" ', 21)).toBeNull();
  });

  it('reads the token the caret stands in, not the one before it', () => {
    expect(facetSuggestAt('$type:npc $ta', 13)).toEqual({ stage: 'key', prefix: 'ta', start: 11, end: 13 });
  });

  /** The parser reads that `$` as part of the value being quoted, and so must the list. */
  it('reads a `$` inside an open quote as the value it is, not a token of its own', () => {
    expect(facetSuggestAt('$tag:"sea $to', 13)).toEqual({
      stage: 'value',
      key: 'tag',
      prefix: 'sea $to',
      start: 5,
      end: 13,
    });
  });

  it('ignores whatever follows the caret — the reader is typing here', () => {
    expect(facetSuggestAt('$ta orc', 3)).toEqual({ stage: 'key', prefix: 'ta', start: 1, end: 3 });
  });
});

describe('facetKeySuggestions (ADR-0082)', () => {
  const keys: FacetKeySet = { reserved: ['type', 'tag', 'visibility'], fields: ['challenge_rating', 'region'] };

  it('offers the whole vocabulary — the reserved names, then every Facet key', () => {
    expect(facetKeySuggestions(keys, '')).toEqual(['type', 'tag', 'visibility', 'challenge_rating', 'region']);
  });

  it('narrows to what has been typed, case-insensitively', () => {
    expect(facetKeySuggestions(keys, 'ty')).toEqual(['type', 'visibility']);
    expect(facetKeySuggestions(keys, 'RE')).toEqual(['region']);
  });

  /** A Facet key is often prefixed (`dnd.challenge_rating`), so the middle of one has to be findable. */
  it('ranks a prefix match ahead of one that merely contains the text', () => {
    expect(facetKeySuggestions(keys, 'ra')).toEqual(['challenge_rating']);
    expect(facetKeySuggestions({ reserved: [], fields: ['rating', 'challenge_rating'] }, 'rating')).toEqual([
      'rating',
      'challenge_rating',
    ]);
  });

  it('offers a reserved name once, even where a Facet key repeats it', () => {
    expect(facetKeySuggestions({ reserved: ['type'], fields: ['type', 'region'] }, '')).toEqual(['type', 'region']);
  });

  it('offers every reserved name where a surface names no subset', () => {
    expect(facetKeySuggestions({}, 'i')).toEqual(['in', 'visibility']);
  });
});

describe('resolvesFacetKey (ADR-0082)', () => {
  it('answers for the names this surface can apply, and for nothing else', () => {
    const keys: FacetKeySet = { reserved: ['type', 'tag'], fields: ['region'] };

    expect(resolvesFacetKey(keys, 'type')).toBe(true);
    expect(resolvesFacetKey(keys, 'region')).toBe(true);
    // Excluded reserved names and unknown keys alike are misses, whatever the Facet read carries.
    expect(resolvesFacetKey(keys, 'in')).toBe(false);
    expect(resolvesFacetKey(keys, 'domain')).toBe(false);
  });

  it('takes every reserved name where a surface names no subset', () => {
    expect(resolvesFacetKey({ fields: [] }, 'in')).toBe(true);
  });
});

describe('facetValuesFor (ADR-0082)', () => {
  const facets: EntityFacets = {
    type: [{ value: 'npc', count: 4 }],
    tag: [{ value: 'draft', count: 2 }],
    visibility: [{ value: 'private', count: 1 }],
    fields: [{ key: 'region', label: 'Region', dataType: { kind: 'string' }, values: [{ value: 'Ashfen', count: 3 }] }],
    container: [{ value: 'w1', count: 9, label: 'Aldermoor' }],
  };

  it('reads a reserved name off its own category, `in` off the Containers', () => {
    expect(facetValuesFor(facets, 'type')).toEqual([{ value: 'npc', count: 4 }]);
    expect(facetValuesFor(facets, 'tag')).toEqual([{ value: 'draft', count: 2 }]);
    expect(facetValuesFor(facets, 'visibility')).toEqual([{ value: 'private', count: 1 }]);
    expect(facetValuesFor(facets, 'in')).toEqual([{ value: 'w1', count: 9, label: 'Aldermoor' }]);
  });

  it('reads any other key off the Field facet that carries it', () => {
    expect(facetValuesFor(facets, 'region')).toEqual([{ value: 'Ashfen', count: 3 }]);
  });

  it('has nothing for a key the read does not carry, or with no read at all', () => {
    expect(facetValuesFor(facets, 'domain')).toEqual([]);
    expect(facetValuesFor(null, 'type')).toEqual([]);
  });
});

describe('facetValueSuggestions (ADR-0082)', () => {
  const values = [
    { value: 'Sea of Storms', count: 3 },
    { value: 'storm-giant', count: 2 },
    { value: 'say "when"', count: 1 },
  ];

  it('keeps the read order, which is the count order', () => {
    expect(facetValueSuggestions(values, '').map((v) => v.value)).toEqual(['Sea of Storms', 'storm-giant']);
  });

  it('narrows case-insensitively, a prefix match first', () => {
    expect(facetValueSuggestions(values, 'storm').map((v) => v.value)).toEqual(['storm-giant', 'Sea of Storms']);
  });

  /** The grammar has no escape character (ADR-0082), so a value carrying a quote stays rail-only. */
  it('drops a value no one could type — one holding a double quote', () => {
    expect(facetValueSuggestions(values, 'say')).toEqual([]);
  });
});

describe('applyFacetSuggestion (ADR-0082)', () => {
  it('completes a key with its colon and leaves the caret ready for a value', () => {
    const raw = 'orc $ta';
    const applied = applyFacetSuggestion(raw, facetSuggestAt(raw, 7)!, 'tag');

    expect(applied).toEqual({ text: 'orc $tag:', caret: 9 });
  });

  it('keeps the negation and whatever follows the caret', () => {
    const raw = '-$ta orc';
    const applied = applyFacetSuggestion(raw, facetSuggestAt(raw, 4)!, 'tag');

    expect(applied).toEqual({ text: '-$tag: orc', caret: 6 });
  });

  it('inserts a value verbatim — the case it is stored in, not the case it was typed in', () => {
    const raw = '$region:ash';
    const applied = applyFacetSuggestion(raw, facetSuggestAt(raw, 11)!, 'Ashfen');

    expect(applied).toEqual({ text: '$region:Ashfen', caret: 14 });
  });

  it('quotes a value the grammar could not otherwise carry', () => {
    const raw = '$tag:sea';
    const applied = applyFacetSuggestion(raw, facetSuggestAt(raw, 8)!, 'sea of storms');

    expect(applied).toEqual({ text: '$tag:"sea of storms"', caret: 20 });
  });

  it('quotes a value holding a comma, which unquoted would read as two', () => {
    const raw = '$tag:';
    const applied = applyFacetSuggestion(raw, facetSuggestAt(raw, 5)!, 'sea, of storms');

    expect(applied.text).toBe('$tag:"sea, of storms"');
  });

  it('quotes a value opening as a comparison, which unquoted would read as a bound', () => {
    const raw = '$challenge_rating:';
    for (const value of ['>=5', '>5', '=5'])
      expect(applyFacetSuggestion(raw, facetSuggestAt(raw, 18)!, value).text).toBe(`$challenge_rating:"${value}"`);
  });

  it('quotes a value opening with a `$`, which after a comma would open a token', () => {
    const raw = '$tag:a,';
    const applied = applyFacetSuggestion(raw, facetSuggestAt(raw, 7)!, '$fx');

    expect(applied.text).toBe('$tag:a,"$fx"');
  });

  it('replaces the open quote it completes rather than nesting inside it', () => {
    const raw = '$tag:"sea of';
    const applied = applyFacetSuggestion(raw, facetSuggestAt(raw, 12)!, 'sea of storms');

    expect(applied).toEqual({ text: '$tag:"sea of storms"', caret: 20 });
  });

  it('leaves the values already listed before the caret alone', () => {
    const raw = '$tag:draft,fan';
    const applied = applyFacetSuggestion(raw, facetSuggestAt(raw, 14)!, 'fantasy');

    expect(applied).toEqual({ text: '$tag:draft,fantasy', caret: 18 });
  });
});
