import { EntitySummary, FacetKeySet } from '@hexly/domain';
import {
  MENTION_CREATE_DETAILS_ID,
  MENTION_CREATE_ID,
  mentionFacetKeys,
  mentionItems,
  parseMentionQuery,
} from './mention-items';

const summary = (id: string, name: string): EntitySummary =>
  ({ id, name, types: ['core.type.note'], tags: [] }) as unknown as EntitySummary;

/** The vocabulary the host World offers a mention (ADR-0082): the reserved names, plus one Facet key. */
const KEYS: FacetKeySet = { reserved: ['type', 'tag', 'visibility'], fields: ['dnd.cr'] };

describe('parseMentionQuery — the name, its Facet Tokens, and the Link Descriptor in one breath', () => {
  it('reads a bare name, with no descriptor', () => {
    expect(parseMentionQuery('Zorblax', KEYS)).toMatchObject({ name: 'Zorblax', descriptor: null });
  });

  it('splits `Name::descriptor` at the first ::', () => {
    expect(parseMentionQuery('Zorblax::rival', KEYS)).toMatchObject({ name: 'Zorblax', descriptor: 'rival' });
  });

  it('keeps multi-word names and descriptors, trimmed', () => {
    expect(parseMentionQuery(' Jane Doe :: capital of ', KEYS)).toMatchObject({
      name: 'Jane Doe',
      descriptor: 'capital of',
    });
  });

  it('reads a trailing :: as no descriptor yet, not an empty one', () => {
    expect(parseMentionQuery('Zorblax::', KEYS)).toMatchObject({ name: 'Zorblax', descriptor: null });
  });

  it('lifts a Facet Token out of the name, so the mention filters and the Create rows mint the rest', () => {
    const parsed = parseMentionQuery('$type:core.type.npc gorb', KEYS);

    expect(parsed.name).toBe('gorb');
    expect(parsed.facets.include.type).toEqual(['core.type.npc']);
    // The raw half is what memoises the search: two boxes spelling different tokens are two searches.
    expect(parsed.raw).toBe('$type:core.type.npc gorb');
  });

  it('reads a token beside a descriptor, each half its own', () => {
    const parsed = parseMentionQuery('-$tag:draft gorb::rival', KEYS);

    expect(parsed).toMatchObject({ name: 'gorb', descriptor: 'rival' });
    expect(parsed.facets.exclude.tag).toEqual(['draft']);
  });

  it('reports a $ name this World answers to nothing as a miss, filtering by nothing', () => {
    const parsed = parseMentionQuery('$domain:sea gorb', KEYS);

    expect(parsed.facets.unresolvedKeys).toEqual(['domain']);
    expect(parsed.facets.fields).toEqual([]);
    expect(parsed.name).toBe('gorb');
  });
});

describe('mentionFacetKeys — what pressing `$` inside a mention offers', () => {
  /** The keys offered for a query whose caret sits at its end, as it does while typing. */
  const offered = (query: string, keys = KEYS) => mentionFacetKeys(query, query.length, keys).map((row) => row.key);

  it('reveals the whole filter vocabulary on the dollar, reserved names and Facet keys alike', () => {
    expect(offered('$')).toEqual(['type', 'tag', 'visibility', 'dnd.cr']);
  });

  it('narrows to what has been typed of the key, what starts with it first', () => {
    expect(offered('gorb $t')).toEqual(['type', 'tag', 'visibility']);
  });

  it('offers nothing where the caret stands in plain text — a name is a name', () => {
    expect(offered('gorb')).toEqual([]);
    expect(offered('e$t')).toEqual([]);
  });

  it('offers no values after the colon: this picker runs no Facet read, so keys are all it knows', () => {
    expect(offered('$type:')).toEqual([]);
    expect(offered('$type:core.type.npc')).toEqual([]);
  });

  it('leaves the Link Descriptor alone — nothing past the `::` names a Facet', () => {
    expect(offered('gorb::$t')).toEqual([]);
  });

  it('completes only what is being typed, never what the caret has already passed', () => {
    // The mention matches to the end of the line, so `gorb` trails a caret sitting after `$t`.
    expect(mentionFacetKeys('$t gorb', 2, KEYS).map((row) => row.key)).toEqual(['type', 'tag', 'visibility']);
    expect(mentionFacetKeys('$t gorb', 2, KEYS)[0]).toMatchObject({ from: 1, to: 2 });
  });
});

describe('mentionItems — the picker rows', () => {
  it('offers Create below the matches, so an existing name never blocks authoring another', () => {
    const items = mentionItems({ name: 'Jane Doe', descriptor: null }, [summary('e1', 'Jane Doe')], true);

    expect(items.map((i) => i.kind)).toEqual(['entity', 'create', 'create-details']);
    expect(items[1]).toMatchObject({ id: MENTION_CREATE_ID, name: 'Jane Doe' });
  });

  it('sits the details row below the plain Create row, so Enter still reaches the fast path first', () => {
    const items = mentionItems({ name: 'Zorblax', descriptor: null }, [], true);

    expect(items.map((i) => i.kind)).toEqual(['create', 'create-details']);
    expect(items[1]).toMatchObject({ id: MENTION_CREATE_DETAILS_ID, name: 'Zorblax' });
  });

  it('makes Create the first — hence the active — row when nothing matches', () => {
    expect(mentionItems({ name: 'Zorblax', descriptor: null }, [], true)[0].kind).toBe('create');
  });

  it('offers no Create row for an empty name — there is nothing to mint', () => {
    expect(mentionItems({ name: '', descriptor: null }, [], true)).toEqual([]);
    expect(mentionItems({ name: '', descriptor: 'rival' }, [summary('e1', 'Jane')], true)).toHaveLength(1);
  });

  it('carries the typed descriptor onto every row, matched or minted', () => {
    const items = mentionItems({ name: 'Zorblax', descriptor: 'rival' }, [summary('e1', 'Zorblax the Devourer')], true);

    expect(items.map((i) => i.descriptor)).toEqual(['rival', 'rival', 'rival']);
  });

  // Inline Creation is a write, so it inherits the Contributor gate (ADR-0073): the rows are absent,
  // never present-and-failing.
  it('withholds both Create rows from a caller who may not create in the host World', () => {
    expect(mentionItems({ name: 'Zorblax', descriptor: null }, [], false)).toEqual([]);
  });

  it('leaves the matches untouched when creation is gated — pick-or-nothing, not nothing', () => {
    const items = mentionItems({ name: 'Jane', descriptor: 'rival' }, [summary('e1', 'Jane Doe')], false);

    expect(items.map((i) => i.kind)).toEqual(['entity']);
    expect(items[0]).toMatchObject({ id: 'e1', descriptor: 'rival' });
  });
});
