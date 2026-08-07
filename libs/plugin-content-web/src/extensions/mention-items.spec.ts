import { EntitySummary, FacetKeySet } from '@hexly/domain';
import { MENTION_CREATE_DETAILS_ID, MENTION_CREATE_ID, mentionItems, parseMentionQuery } from './mention-items';

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
